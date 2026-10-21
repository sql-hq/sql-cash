// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev circomlibjs 0.1.7 poseidonContract.createCode(3).
interface IPoseidon3 {
    function poseidon(uint256[3] calldata inputs) external pure returns (uint256);
}
