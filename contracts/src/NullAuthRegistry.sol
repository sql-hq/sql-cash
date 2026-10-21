// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPoseidon3} from "./interfaces/IPoseidon3.sol";
import {IncrementalTree} from "./libraries/IncrementalTree.sol";

/// @notice Permissionless organization policy commitment registry.
/// Registration is public. The registered policy opening and signer remain
/// private witnesses when authorizing a distribution. Policies are immutable.
contract NullAuthRegistry {
    using IncrementalTree for IncrementalTree.Tree;
    IPoseidon3 public immutable HASHER;
    IncrementalTree.Tree private policies;
    mapping(uint256 => bool) public registered;

    event PolicyRegistered(uint256 indexed policyCommitment, uint256 indexed policyIndex, uint256 postAuthRoot);
    error InvalidDependency();
    error PolicyAlreadyRegistered();

    constructor(IPoseidon3 hasher) {
        if (address(hasher).code.length == 0) revert InvalidDependency();
        HASHER = hasher;
        policies.initialize(hasher);
    }

    function register(uint256 policyCommitment) external {
        if (registered[policyCommitment]) revert PolicyAlreadyRegistered();
        registered[policyCommitment] = true;
        (uint256 index, uint256 root) = policies.insert(HASHER, policyCommitment);
        emit PolicyRegistered(policyCommitment, index, root);
    }

    function authRoot() external view returns (uint256) { return policies.root; }
    function nextPolicyIndex() external view returns (uint256) { return policies.count; }
    function isKnownAuthRoot(uint256 root) external view returns (bool) { return policies.known(root); }
}
