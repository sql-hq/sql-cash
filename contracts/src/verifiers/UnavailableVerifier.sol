// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVerifier} from "../interfaces/IVerifier.sol";

/// @notice Explicitly disabled verifier for source-only inspection environments.
/// NEVER included by the deployment script. This is not a proof verifier.
contract UnavailableVerifier is IVerifier {
    error VerifierArtifactsUnavailable();
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        revert VerifierArtifactsUnavailable();
    }
}
