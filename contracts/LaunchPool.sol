// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ISybilRegistry.sol";
import "./interfaces/ISomniaAgents.sol";

/// @title  LaunchPool (v2)
/// @notice Fair IDO launchpad with three layers of investor protection:
///
///         1. SYBIL GATE — only wallets with a SybilRegistry score >= the pool's
///            minSybilScore can participate, so one person can't sweep the sale
///            with a bot army. (minSybilScore == 0 = open to all.)
///
///         2. MILESTONE-GATED TREASURY — instead of handing the team the entire
///            raise on day one, the raised STT is held in escrow and released in
///            tranches (basis points of the raise) ONLY as Somnia's AI agents
///            verify the team hit real, named milestones. If a milestone fails or
///            its deadline passes, investors CLAW BACK their pro-rata share of the
///            stranded funds. (Opt-in: pools with no fund milestones pay the owner
///            on finalize, the classic behaviour.)
///
///         3. BUYER VESTING — purchased tokens can unlock on a cliff + linear
///            schedule instead of all at once, protecting the token price from an
///            immediate post-launch dump. (buyerVest == 0 = instant, classic.)
contract LaunchPool {
    using SafeERC20 for IERC20;

    // ── Sybil oracle ───────────────────────────────────────────────────────
    ISybilRegistry public immutable sybilRegistry;

    // ── Somnia AI platform (for milestone verification) ─────────────────────
    IAgentRequester public constant PLATFORM =
        IAgentRequester(0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776);
    uint256 public constant PARSE_WEBSITE_AGENT_ID = 12875401142070969085;
    uint256 public constant LLM_AGENT_ID            = 12847293847561029384;
    uint256 public constant PARSE_DEPOSIT = 40e16; // 0.40 STT
    uint256 public constant LLM_DEPOSIT   = 40e16; // 0.40 STT
    uint256 public constant AGENT_TOTAL   = 80e16; // 0.80 STT sent by owner per claim

    uint16  public constant BPS = 10_000;

    // ── Types ──────────────────────────────────────────────────────────────
    enum MStatus { PENDING, VERIFYING, PASSED, FAILED }

    struct Pool {
        address projectToken;
        uint256 tokenPrice;     // STT per token, scaled to 1e18
        uint256 hardCap;
        uint256 softCap;
        uint256 perWalletCap;
        uint256 totalTokens;
        uint256 startTime;
        uint256 endTime;
        uint256 totalRaised;
        uint8   minSybilScore;
        bool    finalized;
        bool    softCapMet;
        // v2 additions
        uint256 finalizedAt;
        uint256 buyerCliff;     // seconds after finalize before tokens start vesting
        uint256 buyerVest;      // linear vest duration in seconds (0 = instant)
        bool    usesTreasury;   // true if fund-release is milestone-gated
        uint256 treasuryReleased; // STT already released to the owner via milestones
    }

    struct PoolParams {
        address projectToken;
        uint256 tokenPrice;
        uint256 hardCap;
        uint256 softCap;
        uint256 perWalletCap;
        uint256 totalTokens;
        uint256 startTime;
        uint256 endTime;
        uint8   minSybilScore;
        uint256 buyerCliff;
        uint256 buyerVest;
    }

    struct FundMilestone {
        string  description;    // plain-English claim the AI verifies
        string  evidenceDomain; // domain the AI searches (e.g. "github.com")
        uint16  releaseBps;     // share of the raise released on PASS
        uint256 deadline;
        MStatus status;
    }

    struct FundMilestoneInput {
        string  description;
        string  evidenceDomain;
        uint16  releaseBps;
        uint256 deadline;
    }

    struct PendingVerify { uint256 poolId; uint256 milestoneIndex; }

    // ── Storage ────────────────────────────────────────────────────────────
    mapping(uint256 => Pool)                        public pools;
    mapping(uint256 => address)                     public poolOwner;
    mapping(uint256 => mapping(address => uint256)) public contributions;     // immutable record
    mapping(uint256 => mapping(address => uint256)) public claimedTokens;     // vesting progress
    mapping(uint256 => mapping(address => bool))    public refunded;          // failed-pool refund
    mapping(uint256 => mapping(address => uint16))  public clawbackedBps;     // treasury clawback progress
    mapping(uint256 => FundMilestone[])             public fundMilestones;
    mapping(uint256 => PendingVerify)               private _pending;         // agent requestId → context
    uint256 public nextPoolId;

    // ── Events ─────────────────────────────────────────────────────────────
    event PoolCreated(uint256 indexed poolId, address indexed owner, address indexed projectToken, uint256 hardCap, uint256 softCap);
    event Participated(uint256 indexed poolId, address indexed participant, uint256 amount, uint256 totalRaised);
    event PoolFinalized(uint256 indexed poolId, bool softCapMet, uint256 totalRaised);
    event TokensClaimed(uint256 indexed poolId, address indexed participant, uint256 tokenAmount);
    event Refunded(uint256 indexed poolId, address indexed participant, uint256 amount);
    // v2
    event FundMilestoneClaimed(uint256 indexed poolId, uint256 indexed milestoneIndex, uint256 requestId);
    event FundMilestonePassed(uint256 indexed poolId, uint256 indexed milestoneIndex, uint256 released);
    event FundMilestoneFailed(uint256 indexed poolId, uint256 indexed milestoneIndex);
    event TreasuryClawback(uint256 indexed poolId, address indexed participant, uint256 amount);
    event AgentDebug(uint256 indexed poolId, uint256 indexed milestoneIndex, string step, uint8 status, bytes firstResult);

    // ── Constructor ────────────────────────────────────────────────────────
    constructor(address _sybilRegistry) {
        require(_sybilRegistry != address(0), "LaunchPool: zero registry");
        sybilRegistry = ISybilRegistry(_sybilRegistry);
    }

    // ── Pool creation ──────────────────────────────────────────────────────

    /// @notice Create an IDO pool. Approve `p.totalTokens` of the project token first.
    ///         Pass `milestones` to milestone-gate the raised funds (sum of
    ///         releaseBps must equal 10000); pass an empty array for the classic
    ///         "owner gets the raise on finalize" behaviour.
    function createPool(PoolParams calldata p, FundMilestoneInput[] calldata milestones)
        external returns (uint256 poolId)
    {
        require(p.projectToken != address(0),  "LaunchPool: zero token");
        require(p.tokenPrice > 0,              "LaunchPool: zero price");
        require(p.softCap > 0,                 "LaunchPool: zero soft cap");
        require(p.hardCap >= p.softCap,        "LaunchPool: hard cap < soft cap");
        require(p.startTime > block.timestamp, "LaunchPool: start in past");
        require(p.endTime > p.startTime,       "LaunchPool: end before start");
        require(p.totalTokens > 0,             "LaunchPool: zero tokens");
        require(p.perWalletCap > 0,            "LaunchPool: zero wallet cap");
        require(p.perWalletCap <= p.hardCap,   "LaunchPool: wallet cap > hard cap");

        bool usesTreasury = milestones.length > 0;
        if (usesTreasury) {
            uint256 sumBps;
            for (uint256 i = 0; i < milestones.length; i++) {
                require(milestones[i].releaseBps > 0,            "LaunchPool: zero bps");
                require(milestones[i].deadline > p.endTime,      "LaunchPool: milestone before sale end");
                sumBps += milestones[i].releaseBps;
            }
            require(sumBps == BPS, "LaunchPool: milestone bps must sum to 10000");
        }

        poolId = nextPoolId++;

        pools[poolId] = Pool({
            projectToken:  p.projectToken,
            tokenPrice:    p.tokenPrice,
            hardCap:       p.hardCap,
            softCap:       p.softCap,
            perWalletCap:  p.perWalletCap,
            totalTokens:   p.totalTokens,
            startTime:     p.startTime,
            endTime:       p.endTime,
            totalRaised:   0,
            minSybilScore: p.minSybilScore,
            finalized:     false,
            softCapMet:    false,
            finalizedAt:   0,
            buyerCliff:    p.buyerCliff,
            buyerVest:     p.buyerVest,
            usesTreasury:  usesTreasury,
            treasuryReleased: 0
        });
        poolOwner[poolId] = msg.sender;

        for (uint256 i = 0; i < milestones.length; i++) {
            fundMilestones[poolId].push(FundMilestone({
                description:    milestones[i].description,
                evidenceDomain: milestones[i].evidenceDomain,
                releaseBps:     milestones[i].releaseBps,
                deadline:       milestones[i].deadline,
                status:         MStatus.PENDING
            }));
        }

        IERC20(p.projectToken).safeTransferFrom(msg.sender, address(this), p.totalTokens);

        emit PoolCreated(poolId, msg.sender, p.projectToken, p.hardCap, p.softCap);
    }

    // ── Participation ──────────────────────────────────────────────────────

    function participate(uint256 poolId) external payable {
        Pool storage pool = pools[poolId];

        require(block.timestamp >= pool.startTime, "LaunchPool: not started");
        require(block.timestamp <= pool.endTime,   "LaunchPool: ended");
        require(!pool.finalized,                   "LaunchPool: finalized");
        require(msg.value > 0,                     "LaunchPool: zero contribution");
        require(pool.totalRaised + msg.value <= pool.hardCap, "LaunchPool: hard cap reached");

        uint256 newContrib = contributions[poolId][msg.sender] + msg.value;
        require(newContrib <= pool.perWalletCap, "LaunchPool: exceeds wallet cap");

        if (pool.minSybilScore > 0) {
            require(
                sybilRegistry.isVerified(msg.sender, pool.minSybilScore),
                "LaunchPool: Sybil check failed - get verified in the Registry first"
            );
        }

        contributions[poolId][msg.sender] = newContrib;
        pool.totalRaised += msg.value;

        emit Participated(poolId, msg.sender, msg.value, pool.totalRaised);
    }

    // ── Finalization ───────────────────────────────────────────────────────

    function finalize(uint256 poolId) external {
        Pool storage pool = pools[poolId];

        require(msg.sender == poolOwner[poolId], "LaunchPool: not owner");
        require(block.timestamp > pool.endTime,  "LaunchPool: not ended");
        require(!pool.finalized,                 "LaunchPool: already finalized");

        pool.finalized   = true;
        pool.finalizedAt = block.timestamp;

        if (pool.totalRaised >= pool.softCap) {
            pool.softCapMet = true;

            // Return unsold tokens to the owner
            uint256 soldTokens   = (pool.totalRaised * 1e18) / pool.tokenPrice;
            uint256 unsoldTokens = pool.totalTokens > soldTokens ? pool.totalTokens - soldTokens : 0;
            if (unsoldTokens > 0) {
                IERC20(pool.projectToken).safeTransfer(poolOwner[poolId], unsoldTokens);
            }

            // Raised STT: milestone-gated treasury holds it; otherwise pay owner now.
            if (!pool.usesTreasury) {
                payable(poolOwner[poolId]).transfer(pool.totalRaised);
            }
        } else {
            // Soft cap missed — all project tokens back to owner; STT held for refunds.
            IERC20(pool.projectToken).safeTransfer(poolOwner[poolId], pool.totalTokens);
        }

        emit PoolFinalized(poolId, pool.softCapMet, pool.totalRaised);
    }

    // ── Buyer claims (vesting-aware) ────────────────────────────────────────

    /// @notice Claim the vested portion of your purchased tokens after a success.
    function claimTokens(uint256 poolId) external {
        Pool storage pool = pools[poolId];
        require(pool.finalized,  "LaunchPool: not finalized");
        require(pool.softCapMet, "LaunchPool: soft cap not met - use refund()");

        uint256 vested = _vestedTokens(poolId, msg.sender);
        uint256 already = claimedTokens[poolId][msg.sender];
        require(vested > already, "LaunchPool: nothing vested yet");

        uint256 amount = vested - already;
        claimedTokens[poolId][msg.sender] = vested;

        IERC20(pool.projectToken).safeTransfer(msg.sender, amount);
        emit TokensClaimed(poolId, msg.sender, amount);
    }

    /// @notice Full STT refund after a failed IDO (soft cap not met).
    function refund(uint256 poolId) external {
        Pool storage pool = pools[poolId];
        require(pool.finalized,  "LaunchPool: not finalized");
        require(!pool.softCapMet,"LaunchPool: soft cap met - use claimTokens()");
        require(!refunded[poolId][msg.sender], "LaunchPool: already refunded");

        uint256 contribution = contributions[poolId][msg.sender];
        require(contribution > 0, "LaunchPool: nothing to refund");

        refunded[poolId][msg.sender] = true;
        payable(msg.sender).transfer(contribution);
        emit Refunded(poolId, msg.sender, contribution);
    }

    // ── Milestone-gated treasury ─────────────────────────────────────────────

    /// @notice Owner triggers AI verification of a fund-release milestone.
    ///         Send >= AGENT_TOTAL (0.80 STT) to cover the two agent calls.
    function claimFundMilestone(uint256 poolId, uint256 milestoneIndex) external payable {
        Pool storage pool = pools[poolId];
        require(msg.sender == poolOwner[poolId], "LaunchPool: not owner");
        require(pool.finalized && pool.softCapMet && pool.usesTreasury, "LaunchPool: no treasury");
        require(milestoneIndex < fundMilestones[poolId].length, "LaunchPool: bad index");
        require(msg.value >= AGENT_TOTAL, "LaunchPool: insufficient agent fee");

        FundMilestone storage m = fundMilestones[poolId][milestoneIndex];
        require(m.status == MStatus.PENDING,   "LaunchPool: not pending");
        require(block.timestamp <= m.deadline, "LaunchPool: deadline passed");

        m.status = MStatus.VERIFYING;

        string[] memory noOptions = new string[](0);
        bytes memory payload = abi.encodeWithSelector(
            IParseWebsiteAgent.ExtractString.selector,
            "milestone_evidence",
            "Evidence the project completed this milestone: metrics, dates, releases, announcements",
            noOptions,
            string.concat(
                "Find evidence on this site that the following project milestone was completed: '",
                m.description,
                "'. Summarise any dates, counts, names, or announcements that confirm or refute it."
            ),
            m.evidenceDomain,
            true,     // resolveUrl = true (domain search — the mode that works)
            uint8(3),
            uint8(40)
        );

        uint256 requestId = PLATFORM.createRequest{value: PARSE_DEPOSIT}(
            PARSE_WEBSITE_AGENT_ID, address(this), this.handleEvidence.selector, payload
        );
        _pending[requestId] = PendingVerify(poolId, milestoneIndex);

        emit FundMilestoneClaimed(poolId, milestoneIndex, requestId);

        if (msg.value > AGENT_TOTAL) payable(msg.sender).transfer(msg.value - AGENT_TOTAL);
    }

    /// @dev Step 1 callback — scraped evidence → fire the LLM verdict.
    function handleEvidence(uint256 requestId, Response[] memory responses, ResponseStatus status, Request memory) external {
        require(msg.sender == address(PLATFORM), "LaunchPool: only platform");
        PendingVerify memory pv = _pending[requestId];
        delete _pending[requestId];
        FundMilestone storage m = fundMilestones[pv.poolId][pv.milestoneIndex];

        if (status != ResponseStatus.Success || responses.length == 0) {
            m.status = MStatus.FAILED;
            emit AgentDebug(pv.poolId, pv.milestoneIndex, "parse", uint8(status), responses.length > 0 ? responses[0].result : bytes(""));
            emit FundMilestoneFailed(pv.poolId, pv.milestoneIndex);
            return;
        }

        string memory scraped = abi.decode(responses[0].result, (string));
        string[] memory allowed = new string[](2);
        allowed[0] = "PASS"; allowed[1] = "FAIL";
        string memory prompt = string.concat(
            "You verify whether a blockchain project milestone was completed.\n\n",
            "Milestone: \"", m.description, "\"\n\n",
            "Evidence found:\n", scraped, "\n\n",
            "Require clear, specific evidence. If ambiguous or missing, reply FAIL. ",
            "Reply with exactly one word: PASS or FAIL"
        );
        bytes memory llmPayload = abi.encodeWithSelector(
            ILLMAgent.inferString.selector,
            prompt,
            "You are a strict, impartial milestone verifier protecting investors' escrowed funds.",
            false,
            allowed
        );
        uint256 llmRequestId = PLATFORM.createRequest{value: LLM_DEPOSIT}(
            LLM_AGENT_ID, address(this), this.handleVerdict.selector, llmPayload
        );
        _pending[llmRequestId] = PendingVerify(pv.poolId, pv.milestoneIndex);
    }

    /// @dev Step 2 callback — PASS releases the tranche to the owner.
    function handleVerdict(uint256 requestId, Response[] memory responses, ResponseStatus status, Request memory) external {
        require(msg.sender == address(PLATFORM), "LaunchPool: only platform");
        PendingVerify memory pv = _pending[requestId];
        delete _pending[requestId];
        Pool storage pool = pools[pv.poolId];
        FundMilestone storage m = fundMilestones[pv.poolId][pv.milestoneIndex];

        if (status != ResponseStatus.Success || responses.length == 0) {
            m.status = MStatus.FAILED;
            emit AgentDebug(pv.poolId, pv.milestoneIndex, "verdict", uint8(status), responses.length > 0 ? responses[0].result : bytes(""));
            emit FundMilestoneFailed(pv.poolId, pv.milestoneIndex);
            return;
        }

        string memory verdict = abi.decode(responses[0].result, (string));
        bool passed = keccak256(bytes(verdict)) == keccak256(bytes("PASS")) && block.timestamp <= m.deadline;

        if (passed) {
            m.status = MStatus.PASSED;
            uint256 release = (pool.totalRaised * m.releaseBps) / BPS;
            pool.treasuryReleased += release;
            payable(poolOwner[pv.poolId]).transfer(release);
            emit FundMilestonePassed(pv.poolId, pv.milestoneIndex, release);
        } else {
            m.status = MStatus.FAILED;
            emit FundMilestoneFailed(pv.poolId, pv.milestoneIndex);
        }
    }

    /// @notice Investors reclaim their pro-rata share of funds tied to milestones
    ///         that FAILED or whose deadline passed unmet. Callable repeatedly as
    ///         more milestones strand.
    function clawback(uint256 poolId) external {
        Pool storage pool = pools[poolId];
        require(pool.finalized && pool.softCapMet && pool.usesTreasury, "LaunchPool: no treasury");

        uint256 contribution = contributions[poolId][msg.sender];
        require(contribution > 0, "LaunchPool: no contribution");

        uint16 failed = _failedBps(poolId);
        uint16 already = clawbackedBps[poolId][msg.sender];
        require(failed > already, "LaunchPool: nothing to claw back");

        uint16 owedBps = failed - already;
        clawbackedBps[poolId][msg.sender] = failed;

        uint256 amount = (contribution * owedBps) / BPS;
        payable(msg.sender).transfer(amount);
        emit TreasuryClawback(poolId, msg.sender, amount);
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    function _vestedTokens(uint256 poolId, address user) internal view returns (uint256) {
        Pool storage pool = pools[poolId];
        uint256 total = (contributions[poolId][user] * 1e18) / pool.tokenPrice;
        if (total == 0) return 0;
        if (pool.buyerVest == 0) return total;                       // instant
        uint256 vestStart = pool.finalizedAt + pool.buyerCliff;
        if (block.timestamp < vestStart) return 0;                   // still in cliff
        uint256 elapsed = block.timestamp - vestStart;
        if (elapsed >= pool.buyerVest) return total;                 // fully vested
        return (total * elapsed) / pool.buyerVest;                   // linear
    }

    /// @dev Basis points of the raise tied to milestones that are failed or expired.
    function _failedBps(uint256 poolId) internal view returns (uint16) {
        FundMilestone[] storage ms = fundMilestones[poolId];
        uint16 failed;
        for (uint256 i = 0; i < ms.length; i++) {
            if (ms[i].status == MStatus.FAILED ||
               (ms[i].status != MStatus.PASSED && block.timestamp > ms[i].deadline)) {
                failed += ms[i].releaseBps;
            }
        }
        return failed;
    }

    // ── View helpers ─────────────────────────────────────────────────────────

    function isActive(uint256 poolId) external view returns (bool) {
        Pool storage p = pools[poolId];
        return block.timestamp >= p.startTime && block.timestamp <= p.endTime && !p.finalized;
    }

    function getContribution(uint256 poolId, address participant) external view returns (uint256) {
        return contributions[poolId][participant];
    }

    /// @notice Total tokens a buyer is entitled to (full allocation, ignoring vesting).
    function getClaimableTokens(uint256 poolId, address participant) external view returns (uint256) {
        Pool storage pool = pools[poolId];
        if (pool.tokenPrice == 0) return 0;
        return (contributions[poolId][participant] * 1e18) / pool.tokenPrice;
    }

    /// @notice Tokens a buyer can claim *right now* given the vesting schedule.
    function getVestedClaimable(uint256 poolId, address participant) external view returns (uint256) {
        uint256 vested = _vestedTokens(poolId, participant);
        uint256 already = claimedTokens[poolId][participant];
        return vested > already ? vested - already : 0;
    }

    /// @notice STT a participant can claw back right now.
    function getClawbackable(uint256 poolId, address participant) external view returns (uint256) {
        Pool storage pool = pools[poolId];
        if (!pool.usesTreasury || !pool.softCapMet) return 0;
        uint16 failed = _failedBps(poolId);
        uint16 already = clawbackedBps[poolId][participant];
        if (failed <= already) return 0;
        return (contributions[poolId][participant] * (failed - already)) / BPS;
    }

    function getFundMilestones(uint256 poolId) external view returns (FundMilestone[] memory) {
        return fundMilestones[poolId];
    }

    function getFundMilestoneCount(uint256 poolId) external view returns (uint256) {
        return fundMilestones[poolId].length;
    }

    /// @dev Accept STT (treasury holdings + the inter-callback agent reserve).
    receive() external payable {}
}
