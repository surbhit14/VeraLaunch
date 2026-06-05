// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ISomniaAgents.sol";
import "./interfaces/IVestingVault.sol";

/// @title  VestingVault
/// @notice Milestone-gated token vesting backed by on-chain consensus AI.
///
///         A project creates a schedule locking all team/investor tokens.
///         Each tranche unlocks only when an AI agent pipeline verifies that
///         the corresponding real-world milestone was genuinely completed:
///
///         Step 1 — LLM Parse Website scrapes the project's evidence URL
///                  (GitHub README, analytics page, audit report, etc.)
///         Step 2 — LLM Inference reads the scraped content and decides
///                  PASS or FAIL against the milestone description.
///
///         Multiple milestones can be in VERIFYING state simultaneously.

contract VestingVault is IVestingVault {
    using SafeERC20 for IERC20;

    // ── Somnia platform ────────────────────────────────────────────────────
    IAgentRequester public constant PLATFORM =
        IAgentRequester(0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776);

    uint256 public constant PARSE_WEBSITE_AGENT_ID = 12875401142070969085;
    uint256 public constant LLM_AGENT_ID            = 12847293847561029384;

    // ── Deposits ───────────────────────────────────────────────────────────
    // Somnia agent cost = platform reserve (~0.03) + 0.10 STT per validator.
    // Default subcommittee is 3 → minimum 0.33 STT/step. We add a buffer so a
    // request is never rejected at the edge of the minimum.
    uint256 public constant PARSE_DEPOSIT  = 40e16;  // 0.40 STT (min 0.33 + buffer)
    uint256 public constant LLM_DEPOSIT    = 40e16;  // 0.40 STT (min 0.33 + buffer)
    uint256 public constant TOTAL_DEPOSIT  = 80e16;  // 0.80 STT sent by caller

    // ── Types ──────────────────────────────────────────────────────────────
    enum MilestoneStatus { PENDING, VERIFYING, PASSED, FAILED }

    struct Milestone {
        string          description;  // natural language requirement
        string          evidenceUrl;  // URL agents will scrape
        uint256         unlockAmount; // tokens released on PASS
        uint256         deadline;     // unix timestamp — must claim before this
        MilestoneStatus status;
    }

    struct VestingSchedule {
        address beneficiary;
        address token;
        uint256 totalAmount;
        uint256 unlockedAmount;
    }

    struct MilestoneInput {
        string  description;
        string  evidenceUrl;
        uint256 unlockAmount;
        uint256 deadline;
    }

    struct PendingVerification {
        uint256 scheduleId;
        uint256 milestoneIndex;
    }

    // ── Storage ────────────────────────────────────────────────────────────
    mapping(uint256 => VestingSchedule) public  schedules;
    mapping(uint256 => Milestone[])     public  milestones;  // scheduleId → milestones
    mapping(uint256 => PendingVerification) private _pending; // requestId → context
    uint256 public nextScheduleId;

    // ── Events ─────────────────────────────────────────────────────────────
    event ScheduleCreated(
        uint256 indexed scheduleId,
        address indexed beneficiary,
        address indexed token,
        uint256 totalAmount,
        uint256 milestoneCount
    );
    event MilestoneClaimed(
        uint256 indexed scheduleId,
        uint256 indexed milestoneIndex,
        uint256 indexed parseRequestId
    );
    event EvidenceCollected(
        uint256 indexed scheduleId,
        uint256 indexed milestoneIndex,
        uint256 indexed llmRequestId
    );
    event MilestonePassed(
        uint256 indexed scheduleId,
        uint256 indexed milestoneIndex,
        uint256 unlockedAmount
    );
    event MilestoneFailed(
        uint256 indexed scheduleId,
        uint256 indexed milestoneIndex
    );
    event TokensUnlocked(address indexed beneficiary, address indexed token, uint256 amount);
    /// @dev Emitted on any agent-callback failure with the raw validator response
    ///      bytes the platform handed us — makes failures self-diagnosing on-chain.
    event AgentDebug(
        uint256 indexed scheduleId,
        uint256 indexed milestoneIndex,
        string  step,        // "parse" or "verdict"
        uint8   status,      // ResponseStatus
        uint256 numResponses,
        bytes   firstResult
    );
    event MilestoneReset(uint256 indexed scheduleId, uint256 indexed milestoneIndex);
    event EmergencyWithdrawal(uint256 indexed scheduleId, address indexed beneficiary, uint256 amount);

    // ── Create schedule ────────────────────────────────────────────────────

    /// @notice Lock tokens in the vault with a set of milestone conditions.
    ///         Caller must have approved this contract to transfer `totalAmount` tokens.
    ///         The sum of all milestone unlockAmounts must equal totalAmount.
    function createSchedule(
        address           token,
        uint256           totalAmount,
        address           beneficiary,
        MilestoneInput[] calldata milestoneInputs
    ) external returns (uint256 scheduleId) {
        require(token != address(0),       "VestingVault: zero token");
        require(totalAmount > 0,           "VestingVault: zero amount");
        require(beneficiary != address(0), "VestingVault: zero beneficiary");
        require(milestoneInputs.length > 0, "VestingVault: no milestones");

        // Validate milestone amounts sum to totalAmount
        uint256 sum;
        for (uint256 i = 0; i < milestoneInputs.length; i++) {
            require(milestoneInputs[i].unlockAmount > 0, "VestingVault: zero unlock");
            require(milestoneInputs[i].deadline > block.timestamp, "VestingVault: past deadline");
            sum += milestoneInputs[i].unlockAmount;
        }
        require(sum == totalAmount, "VestingVault: amounts must sum to total");

        scheduleId = nextScheduleId++;

        schedules[scheduleId] = VestingSchedule({
            beneficiary:    beneficiary,
            token:          token,
            totalAmount:    totalAmount,
            unlockedAmount: 0
        });

        for (uint256 i = 0; i < milestoneInputs.length; i++) {
            milestones[scheduleId].push(Milestone({
                description:  milestoneInputs[i].description,
                evidenceUrl:  milestoneInputs[i].evidenceUrl,
                unlockAmount: milestoneInputs[i].unlockAmount,
                deadline:     milestoneInputs[i].deadline,
                status:       MilestoneStatus.PENDING
            }));
        }

        IERC20(token).safeTransferFrom(msg.sender, address(this), totalAmount);

        emit ScheduleCreated(scheduleId, beneficiary, token, totalAmount, milestoneInputs.length);
    }

    // ── Claim milestone: Step 1 ────────────────────────────────────────────

    /// @notice Trigger AI verification for a PENDING milestone.
    ///         Only callable by the schedule beneficiary.
    ///         Caller must send >= TOTAL_DEPOSIT (0.60 STT). Excess is refunded.
    function claimMilestone(
        uint256 scheduleId,
        uint256 milestoneIndex
    ) external payable {
        VestingSchedule storage schedule = schedules[scheduleId];
        require(msg.sender == schedule.beneficiary, "VestingVault: not beneficiary");
        require(milestoneIndex < milestones[scheduleId].length, "VestingVault: bad index");
        require(msg.value >= TOTAL_DEPOSIT, "VestingVault: insufficient deposit");

        Milestone storage m = milestones[scheduleId][milestoneIndex];
        require(m.status == MilestoneStatus.PENDING,      "VestingVault: not pending");
        require(block.timestamp <= m.deadline,            "VestingVault: deadline passed");

        m.status = MilestoneStatus.VERIFYING;

        string[] memory noOptions = new string[](0);

        // The Parse Website agent only works in domain-SEARCH mode (resolveUrl=true):
        //   - evidenceUrl is treated as a DOMAIN (e.g. "github.com", a project site)
        //   - the `prompt` is used as the natural-language SEARCH QUERY
        //   - direct-scrape mode (resolveUrl=false) does not work in the validator sandbox
        bytes memory payload = abi.encodeWithSelector(
            IParseWebsiteAgent.ExtractString.selector,
            "milestone_evidence",
            "Evidence that the milestone was completed: metrics, counts, dates, announcements, audit results",
            noOptions,
            string.concat(
                "Find evidence on this site that the following project milestone was completed: '",
                m.description,
                "'. Summarise any dates, counts, names, or announcements that confirm or refute it."
            ),
            m.evidenceUrl,
            true,     // resolveUrl = true — domain search (the only mode that works)
            uint8(3), // search up to 3 pages
            uint8(40) // confidence threshold
        );

        uint256 requestId = PLATFORM.createRequest{value: PARSE_DEPOSIT}(
            PARSE_WEBSITE_AGENT_ID,
            address(this),
            this.handleEvidenceResponse.selector,
            payload
        );

        _pending[requestId] = PendingVerification({
            scheduleId:     scheduleId,
            milestoneIndex: milestoneIndex
        });

        emit MilestoneClaimed(scheduleId, milestoneIndex, requestId);

        // Refund excess beyond what both agent calls will need
        uint256 totalNeeded = PARSE_DEPOSIT + LLM_DEPOSIT;
        if (msg.value > totalNeeded) {
            payable(msg.sender).transfer(msg.value - totalNeeded);
        }
    }

    // ── Step 1 Callback: fire LLM with scraped evidence ───────────────────
    function handleEvidenceResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external {
        require(msg.sender == address(PLATFORM), "VestingVault: only platform");

        PendingVerification memory pv = _pending[requestId];
        delete _pending[requestId];

        uint256 scheduleId     = pv.scheduleId;
        uint256 milestoneIndex = pv.milestoneIndex;
        Milestone storage m    = milestones[scheduleId][milestoneIndex];

        if (status != ResponseStatus.Success || responses.length == 0) {
            m.status = MilestoneStatus.FAILED;
            emit AgentDebug(scheduleId, milestoneIndex, "parse", uint8(status),
                responses.length, responses.length > 0 ? responses[0].result : bytes(""));
            emit MilestoneFailed(scheduleId, milestoneIndex);
            return;
        }

        string memory scrapedContent = abi.decode(responses[0].result, (string));

        string[] memory allowedValues = new string[](2);
        allowedValues[0] = "PASS";
        allowedValues[1] = "FAIL";

        string memory prompt = string.concat(
            "You are verifying whether a blockchain project milestone has been completed.\n\n"
            "Milestone requirement: \"", m.description, "\"\n\n"
            "Evidence scraped from ", m.evidenceUrl, ":\n",
            scrapedContent,
            "\n\n"
            "Rules:\n"
            "- Require clear, specific, quantitative evidence\n"
            "- Reject vague claims, unverifiable assertions, or missing data\n"
            "- Watch for metric gaming (e.g. fake users, wash transactions)\n"
            "- If evidence is ambiguous or insufficient, reply FAIL\n\n"
            "Reply with exactly one word: PASS or FAIL"
        );

        bytes memory llmPayload = abi.encodeWithSelector(
            ILLMAgent.inferString.selector,
            prompt,
            "You are a strict, impartial milestone verifier for a token launchpad. Your role is to protect investors by preventing teams from gaming their vesting schedule.",
            false,        // chainOfThought
            allowedValues
        );

        uint256 llmRequestId = PLATFORM.createRequest{value: LLM_DEPOSIT}(
            LLM_AGENT_ID,
            address(this),
            this.handleVerdictResponse.selector,
            llmPayload
        );

        _pending[llmRequestId] = PendingVerification({
            scheduleId:     scheduleId,
            milestoneIndex: milestoneIndex
        });

        emit EvidenceCollected(scheduleId, milestoneIndex, llmRequestId);
    }

    // ── Step 2 Callback: resolve milestone ────────────────────────────────
    function handleVerdictResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external {
        require(msg.sender == address(PLATFORM), "VestingVault: only platform");

        PendingVerification memory pv = _pending[requestId];
        delete _pending[requestId];

        uint256 scheduleId     = pv.scheduleId;
        uint256 milestoneIndex = pv.milestoneIndex;
        Milestone storage m    = milestones[scheduleId][milestoneIndex];
        VestingSchedule storage s = schedules[scheduleId];

        if (status != ResponseStatus.Success || responses.length == 0) {
            m.status = MilestoneStatus.FAILED;
            emit AgentDebug(scheduleId, milestoneIndex, "verdict", uint8(status),
                responses.length, responses.length > 0 ? responses[0].result : bytes(""));
            emit MilestoneFailed(scheduleId, milestoneIndex);
            return;
        }

        string memory verdict = abi.decode(responses[0].result, (string));
        bool passed = keccak256(bytes(verdict)) == keccak256(bytes("PASS"));

        if (passed) {
            m.status = MilestoneStatus.PASSED;
            s.unlockedAmount += m.unlockAmount;

            IERC20(s.token).safeTransfer(s.beneficiary, m.unlockAmount);

            emit MilestonePassed(scheduleId, milestoneIndex, m.unlockAmount);
            emit TokensUnlocked(s.beneficiary, s.token, m.unlockAmount);
        } else {
            m.status = MilestoneStatus.FAILED;
            emit MilestoneFailed(scheduleId, milestoneIndex);
        }
    }

    // ── Milestone recovery ─────────────────────────────────────────────────

    /// @notice Reset a FAILED milestone back to PENDING so it can be retried.
    ///         Only the beneficiary may call this — they already bear the cost
    ///         of re-paying the 0.60 STT agent fee on the next claimMilestone call.
    ///         Intended for cases where the AI platform had a transient failure
    ///         that incorrectly marked a completed milestone as FAILED.
    function resetMilestone(uint256 scheduleId, uint256 milestoneIndex) external {
        VestingSchedule storage schedule = schedules[scheduleId];
        require(msg.sender == schedule.beneficiary,            "VestingVault: not beneficiary");
        require(milestoneIndex < milestones[scheduleId].length, "VestingVault: bad index");

        Milestone storage m = milestones[scheduleId][milestoneIndex];
        require(m.status == MilestoneStatus.FAILED, "VestingVault: only FAILED milestones can be reset");
        require(block.timestamp <= m.deadline,      "VestingVault: deadline passed");

        m.status = MilestoneStatus.PENDING;

        emit MilestoneReset(scheduleId, milestoneIndex);
    }

    /// @notice Emergency withdrawal of all remaining locked tokens.
    ///         Only callable by the beneficiary, and only after ALL milestones
    ///         have passed their deadline (i.e. there is no legitimate path left
    ///         to unlock them via the AI pipeline).
    ///         Releases only the portion that was never unlocked.
    function emergencyWithdraw(uint256 scheduleId) external {
        VestingSchedule storage schedule = schedules[scheduleId];
        require(msg.sender == schedule.beneficiary, "VestingVault: not beneficiary");

        Milestone[] storage ms = milestones[scheduleId];

        // All milestones must be either past their deadline or already resolved
        // (PASSED/FAILED), with none still PENDING or VERIFYING.
        for (uint256 i = 0; i < ms.length; i++) {
            MilestoneStatus s = ms[i].status;
            if (s == MilestoneStatus.PENDING || s == MilestoneStatus.VERIFYING) {
                require(
                    block.timestamp > ms[i].deadline,
                    "VestingVault: active milestone exists - use claimMilestone first"
                );
            }
        }

        uint256 remaining = schedule.totalAmount - schedule.unlockedAmount;
        require(remaining > 0, "VestingVault: nothing to withdraw");

        schedule.unlockedAmount = schedule.totalAmount; // mark all as consumed

        IERC20(schedule.token).safeTransfer(schedule.beneficiary, remaining);

        emit EmergencyWithdrawal(scheduleId, schedule.beneficiary, remaining);
    }

    // ── IVestingVault ──────────────────────────────────────────────────────

    function getUnlocked(uint256 scheduleId) external view returns (uint256) {
        return schedules[scheduleId].unlockedAmount;
    }

    function getMilestoneCount(uint256 scheduleId) external view returns (uint256) {
        return milestones[scheduleId].length;
    }

    // ── View helpers ───────────────────────────────────────────────────────

    function getMilestones(uint256 scheduleId) external view returns (Milestone[] memory) {
        return milestones[scheduleId];
    }

    function getMilestone(
        uint256 scheduleId,
        uint256 milestoneIndex
    ) external view returns (Milestone memory) {
        return milestones[scheduleId][milestoneIndex];
    }

    /// @dev Accept STT to hold the step-2 reserve between callbacks
    receive() external payable {}
}
