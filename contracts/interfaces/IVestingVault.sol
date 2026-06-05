// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  IVestingVault
/// @notice External read interface for VestingVault
interface IVestingVault {
    /// @notice Returns total tokens unlocked so far for a schedule
    function getUnlocked(uint256 scheduleId) external view returns (uint256);

    /// @notice Returns the number of milestones in a schedule
    function getMilestoneCount(uint256 scheduleId) external view returns (uint256);
}
