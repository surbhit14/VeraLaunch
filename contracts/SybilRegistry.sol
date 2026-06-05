// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/ISomniaAgents.sol";
import "./interfaces/ISybilRegistry.sol";

/// @title  SybilRegistry
/// @notice Scores a wallet's "humanness" 0-100 from its on-chain activity, using
///         Somnia's deterministic JSON API agent.
///
///         Flow (single agent call):
///           1. requestAttestation(wallet) asks the JSON API agent to fetch the
///              wallet's `transactions_count` from the block-explorer REST API.
///           2. handleTxCount() receives the count and derives a transparent,
///              banded score on-chain. More activity => higher score.
///
///         The JSON API agent is the correct tool here: reading a structured
///         on-chain metric is a deterministic data-fetch, not a language task.
///         (The earlier Parse Website + LLM design could not look up wallet data
///         via web search — see the project history.)
///
///         Attestations are valid for 90 days and reusable across all LaunchPools
///         that read this registry.

contract SybilRegistry is ISybilRegistry {

    // ── Somnia platform ────────────────────────────────────────────────────
    IAgentRequester public constant PLATFORM =
        IAgentRequester(0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776);

    // JSON API Request agent — fetchUint(url, selector, decimals)
    uint256 public constant JSON_API_AGENT_ID = 13174292974160097713;

    // ── Deposit ──────────────────────────────────────────────────────────────
    // JSON API cost = platform reserve (~0.03) + 0.03 STT per validator (~0.12 min).
    // The score uses TWO signals (tx count + balance), so two chained agent calls.
    // We send a buffer so neither call is rejected at the edge of the minimum;
    // excess is refunded.
    uint256 public constant JSON_DEPOSIT  = 17e16;  // 0.17 STT per call
    uint256 public constant TOTAL_DEPOSIT = 40e16;  // 0.40 STT sent by caller (2 calls)

    // ── Attestation TTL ────────────────────────────────────────────────────
    uint256 public constant ATTESTATION_TTL = 90 days;

    // Block-explorer REST API. The wallet address is appended to the base, e.g.
    //   https://api.testnet.somnia.exploreme.pro/accounts/0xABC...
    // which returns JSON like
    //   {"address":"0x..","balance":3962...,"txsCount":75,"internalTxsCount":90,...}
    // The JSON API agent reads the `txsCount` field (a plain integer).
    // This is the explorer that actually indexes chainId 50312 wallet activity
    // (shannon-explorer returns 0; socialscan's /api/v2 returns HTTP 500).
    string public constant EXPLORER_BASE = "https://api.testnet.somnia.exploreme.pro/accounts/";
    string public constant TXCOUNT_SELECTOR = "txsCount";
    string public constant BALANCE_SELECTOR = "balance"; // native balance in wei

    // ── Storage ────────────────────────────────────────────────────────────
    struct Attestation {
        uint8   score;      // 0-100; higher = more active + more capital = more likely human
        uint256 timestamp;
        uint256 expiresAt;
        bool    exists;
    }

    mapping(address => Attestation) public  attestations;
    mapping(uint256 => address)     private _pending;     // requestId → wallet
    mapping(address => uint256)     private _partialTx;   // wallet → txCount carried between the 2 calls

    // ── Events ─────────────────────────────────────────────────────────────
    event AttestationRequested(address indexed wallet, uint256 indexed requestId);
    event AttestationStored(address indexed wallet, uint8 score, uint256 txCount, uint256 balanceWei);
    event AttestationFailed(address indexed wallet, ResponseStatus status);
    /// @dev Self-diagnosing: emits the raw validator bytes on any callback failure.
    event AgentDebug(address indexed wallet, string step, uint8 status, uint256 numResponses, bytes firstResult);

    // ── Step 1: fetch transaction count ──────────────────────────────────────
    /// @notice Request a Sybil attestation. Caller must send >= TOTAL_DEPOSIT
    ///         (0.40 STT, covers two JSON API calls). Excess is refunded.
    function requestAttestation(address wallet) external payable {
        require(msg.value >= TOTAL_DEPOSIT, "SybilRegistry: insufficient deposit");
        require(wallet != address(0),       "SybilRegistry: zero address");

        uint256 requestId = PLATFORM.createRequest{value: JSON_DEPOSIT}(
            JSON_API_AGENT_ID,
            address(this),
            this.handleTxCount.selector,
            _fetchPayload(wallet, TXCOUNT_SELECTOR)
        );
        _pending[requestId] = wallet;

        emit AttestationRequested(wallet, requestId);

        // keep JSON_DEPOSIT for the second (balance) call; refund the rest
        if (msg.value > 2 * JSON_DEPOSIT) {
            payable(msg.sender).transfer(msg.value - 2 * JSON_DEPOSIT);
        }
    }

    // ── Step 1 callback: store tx count, fetch balance ──────────────────────
    function handleTxCount(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external {
        require(msg.sender == address(PLATFORM), "SybilRegistry: only platform");
        address wallet = _pending[requestId];
        delete _pending[requestId];

        if (status != ResponseStatus.Success || responses.length == 0) {
            emit AgentDebug(wallet, "txCount", uint8(status), responses.length, responses.length > 0 ? responses[0].result : bytes(""));
            emit AttestationFailed(wallet, status);
            return;
        }

        _partialTx[wallet] = abi.decode(responses[0].result, (uint256));

        uint256 reqId2 = PLATFORM.createRequest{value: JSON_DEPOSIT}(
            JSON_API_AGENT_ID,
            address(this),
            this.handleBalance.selector,
            _fetchPayload(wallet, BALANCE_SELECTOR)
        );
        _pending[reqId2] = wallet;
    }

    // ── Step 2 callback: combine signals, store attestation ─────────────────
    function handleBalance(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external {
        require(msg.sender == address(PLATFORM), "SybilRegistry: only platform");
        address wallet = _pending[requestId];
        delete _pending[requestId];

        uint256 txCount = _partialTx[wallet];
        delete _partialTx[wallet];

        if (status != ResponseStatus.Success || responses.length == 0) {
            emit AgentDebug(wallet, "balance", uint8(status), responses.length, responses.length > 0 ? responses[0].result : bytes(""));
            emit AttestationFailed(wallet, status);
            return;
        }

        uint256 balanceWei = abi.decode(responses[0].result, (uint256));
        uint8 score = _score(txCount, balanceWei / 1e18); // balance in whole STT

        attestations[wallet] = Attestation({
            score:     score,
            timestamp: block.timestamp,
            expiresAt: block.timestamp + ATTESTATION_TTL,
            exists:    true
        });

        emit AttestationStored(wallet, score, txCount, balanceWei);
    }

    /// @dev Weighted, transparent score. Activity (cheap to farm) is capped at 50;
    ///      real capital held (costly to fake at scale) adds up to 50 more. A bot
    ///      army would need both many transactions AND real STT in every wallet.
    function _score(uint256 txCount, uint256 balSTT) internal pure returns (uint8) {
        uint256 t = txCount == 0 ? 0 : txCount < 5 ? 15 : txCount < 20 ? 30 : txCount < 100 ? 40 : 50;
        uint256 b = balSTT  == 0 ? 0 : balSTT  < 5 ? 20 : balSTT  < 20 ? 35 : balSTT  < 100 ? 45 : 50;
        uint256 s = t + b;
        return uint8(s > 100 ? 100 : s);
    }

    function _fetchPayload(address wallet, string memory selector) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(
            IJsonApiAgent.fetchUint.selector,
            string.concat(EXPLORER_BASE, _addressToString(wallet)),
            selector,
            uint8(0)
        );
    }

    // ── ISybilRegistry ─────────────────────────────────────────────────────

    function isVerified(address wallet, uint8 minScore) external view returns (bool) {
        Attestation storage a = attestations[wallet];
        return a.exists && a.score >= minScore && block.timestamp <= a.expiresAt;
    }

    function getScore(address wallet) external view returns (uint8) {
        return attestations[wallet].score;
    }

    function isExpired(address wallet) external view returns (bool) {
        Attestation storage a = attestations[wallet];
        return !a.exists || block.timestamp > a.expiresAt;
    }

    // ── Internal helpers ───────────────────────────────────────────────────

    /// @dev Converts an address to its lowercase "0x..." hex string.
    function _addressToString(address addr) internal pure returns (string memory) {
        bytes memory data    = abi.encodePacked(addr);
        bytes memory hexChars = "0123456789abcdef";
        bytes memory result  = new bytes(42);
        result[0] = "0";
        result[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            result[2 + i * 2] = hexChars[uint8(data[i] >> 4)];
            result[3 + i * 2] = hexChars[uint8(data[i] & 0x0f)];
        }
        return string(result);
    }

    /// @dev Accept STT transfers.
    receive() external payable {}
}
