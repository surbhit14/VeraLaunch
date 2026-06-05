// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/ISomniaAgents.sol";

/// @title  TrustOracle
/// @notice Autonomous, AI-derived "project trust score" (0-100) for launchpad
///         projects — the buyer-side counterpart to the SybilRegistry.
///
///         A project is registered with a name + domain. Somnia's Parse Website
///         agent searches the domain and the LLM agent rates the project's
///         legitimacy 0-100. The keeper agent discovers registered-but-unscored
///         projects and triggers scoring with no human input, so buyers see a
///         trust signal on every launch card.
contract TrustOracle {
    // ── Somnia platform ────────────────────────────────────────────────────
    IAgentRequester public constant PLATFORM =
        IAgentRequester(0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776);
    uint256 public constant PARSE_WEBSITE_AGENT_ID = 12875401142070969085;
    uint256 public constant LLM_AGENT_ID            = 12847293847561029384;
    uint256 public constant PARSE_DEPOSIT = 40e16; // 0.40 STT
    uint256 public constant LLM_DEPOSIT   = 40e16; // 0.40 STT
    uint256 public constant TOTAL_DEPOSIT = 80e16; // 0.80 STT

    enum TrustStatus { NONE, REGISTERED, SCORING, SCORED, FAILED }

    struct Project {
        string  name;
        string  domain;
        uint8   score;       // 0-100
        TrustStatus status;
        uint256 updatedAt;
    }

    mapping(uint256 => Project)  public projects;        // poolId → project
    mapping(uint256 => uint256)  private _pending;       // agent requestId → poolId

    event ProjectRegistered(uint256 indexed poolId, string name, string domain);
    event TrustRequested(uint256 indexed poolId, uint256 requestId);
    event TrustScored(uint256 indexed poolId, uint8 score);
    event TrustFailed(uint256 indexed poolId);
    event AgentDebug(uint256 indexed poolId, string step, uint8 status, bytes firstResult);

    /// @notice Register a project's metadata so it can be scored.
    function registerProject(uint256 poolId, string calldata name, string calldata domain) external {
        require(bytes(domain).length > 0, "TrustOracle: empty domain");
        Project storage p = projects[poolId];
        require(p.status == TrustStatus.NONE, "TrustOracle: already registered");
        p.name = name;
        p.domain = domain;
        p.status = TrustStatus.REGISTERED;
        p.updatedAt = block.timestamp;
        emit ProjectRegistered(poolId, name, domain);
    }

    /// @notice Trigger AI scoring of a registered project. Send >= 0.80 STT.
    ///         Idempotent-friendly: callable when REGISTERED or after FAILED.
    function requestTrustScore(uint256 poolId) external payable {
        Project storage p = projects[poolId];
        // Re-scorable any time except while a request is already in flight.
        require(p.status != TrustStatus.NONE && p.status != TrustStatus.SCORING, "TrustOracle: not scorable");
        require(msg.value >= TOTAL_DEPOSIT, "TrustOracle: insufficient deposit");

        p.status = TrustStatus.SCORING;

        string[] memory noOptions = new string[](0);
        bytes memory payload = abi.encodeWithSelector(
            IParseWebsiteAgent.ExtractString.selector,
            "project_legitimacy",
            "What this website/project is, and any signals of legitimacy: product, docs, team, audits, activity, community",
            noOptions,
            // Generic so the agent always extracts the site's actual content; the LLM
            // then judges legitimacy from it. (Querying for a specific name the site
            // doesn't contain makes the agent return nothing and fail.)
            "Summarise what this website is about and any evidence that it represents a real, active, legitimate crypto project.",
            p.domain,
            true,      // resolveUrl = true (domain search)
            uint8(3),
            uint8(0)   // accept whatever is found — don't fail on a confidence threshold
        );
        // Single validator (threshold 1): a legitimacy summary is free-form text, so a
        // 3-validator majority can't agree on identical strings. For this advisory score
        // we take one agent's result. (Sybil + milestone verification keep full consensus.)
        uint256 requestId = PLATFORM.createAdvancedRequest{value: PARSE_DEPOSIT}(
            PARSE_WEBSITE_AGENT_ID, address(this), this.handleEvidence.selector, payload,
            1, 1, ConsensusType.Majority, 300
        );
        _pending[requestId] = poolId;

        emit TrustRequested(poolId, requestId);
        if (msg.value > TOTAL_DEPOSIT) payable(msg.sender).transfer(msg.value - TOTAL_DEPOSIT);
    }

    function handleEvidence(uint256 requestId, Response[] memory responses, ResponseStatus status, Request memory) external {
        require(msg.sender == address(PLATFORM), "TrustOracle: only platform");
        uint256 poolId = _pending[requestId];
        delete _pending[requestId];
        Project storage p = projects[poolId];

        if (status != ResponseStatus.Success || responses.length == 0) {
            p.status = TrustStatus.FAILED;
            emit AgentDebug(poolId, "parse", uint8(status), responses.length > 0 ? responses[0].result : bytes(""));
            emit TrustFailed(poolId);
            return;
        }

        string memory evidence = abi.decode(responses[0].result, (string));
        string memory prompt = string.concat(
            "Rate the legitimacy of the crypto project '", p.name, "' from 0 to 100, ",
            "where 100 = clearly legitimate with real product/docs/team and 0 = scam or no evidence.\n\n",
            "Evidence from ", p.domain, ":\n", evidence, "\n\n",
            "Return only a single integer 0-100."
        );
        bytes memory llmPayload = abi.encodeWithSelector(
            ILLMAgent.inferNumber.selector,
            prompt,
            "You are a careful crypto due-diligence analyst. Return only a number 0-100.",
            int256(0), int256(100), false
        );
        uint256 llmRequestId = PLATFORM.createAdvancedRequest{value: LLM_DEPOSIT}(
            LLM_AGENT_ID, address(this), this.handleScore.selector, llmPayload,
            1, 1, ConsensusType.Majority, 300
        );
        _pending[llmRequestId] = poolId;
    }

    function handleScore(uint256 requestId, Response[] memory responses, ResponseStatus status, Request memory) external {
        require(msg.sender == address(PLATFORM), "TrustOracle: only platform");
        uint256 poolId = _pending[requestId];
        delete _pending[requestId];
        Project storage p = projects[poolId];

        if (status != ResponseStatus.Success || responses.length == 0) {
            p.status = TrustStatus.FAILED;
            emit AgentDebug(poolId, "llm", uint8(status), responses.length > 0 ? responses[0].result : bytes(""));
            emit TrustFailed(poolId);
            return;
        }

        int256 raw = abi.decode(responses[0].result, (int256));
        uint8 score = uint8(uint256(raw > 100 ? int256(100) : raw < 0 ? int256(0) : raw));
        p.score = score;
        p.status = TrustStatus.SCORED;
        p.updatedAt = block.timestamp;
        emit TrustScored(poolId, score);
    }

    // ── Views ────────────────────────────────────────────────────────────────
    function getProject(uint256 poolId) external view returns (Project memory) {
        return projects[poolId];
    }

    receive() external payable {}
}
