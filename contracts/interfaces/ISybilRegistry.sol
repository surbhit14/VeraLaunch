// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  ISybilRegistry
/// @notice Read interface consumed by LaunchPool and any external protocol
interface ISybilRegistry {
    /// @notice Returns true if wallet has a valid, non-expired attestation >= minScore
    function isVerified(address wallet, uint8 minScore) external view returns (bool);

    /// @notice Returns the raw 0-100 Sybil uniqueness score for a wallet
    function getScore(address wallet) external view returns (uint8);

    /// @notice Returns true if the attestation does not exist or has expired
    function isExpired(address wallet) external view returns (bool);
}
