// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev The generated Barretenberg UltraHonk verification ABI. Implementations
/// must be generated from the pinned circuit; no permissive verifier is shipped.
interface IVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}
