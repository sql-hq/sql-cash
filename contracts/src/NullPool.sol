// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "./interfaces/IERC20.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";
import {IPoseidon3} from "./interfaces/IPoseidon3.sol";
import {IncrementalTree} from "./libraries/IncrementalTree.sol";
import {Domains} from "./libraries/Domains.sol";
import {NullAuthRegistry} from "./NullAuthRegistry.sol";

/// @notice Immutable, single-asset private distribution pool. Testnet prototype.
/// @dev No owner, upgrade, pause, reserve extraction, or nullifier override exists.
/// Proof artifacts must be generated from the corresponding versioned circuits.
contract NullPool {
    using IncrementalTree for IncrementalTree.Tree;
    uint256 public constant PROTOCOL_VERSION = 1;
    uint256 public constant DISTRIBUTION_SLOTS = 8;
    uint256 public constant CIPHERTEXT_BYTES = 540;
    uint256 public constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    IERC20 public immutable ASSET;
    IPoseidon3 public immutable HASHER;
    NullAuthRegistry public immutable AUTH_REGISTRY;
    IVerifier public immutable shieldVerifier;
    IVerifier public immutable createDistributionVerifier;
    IVerifier public immutable claimVerifier;
    IVerifier public immutable withdrawVerifier;
    bytes32 public immutable shieldVerifierCodeHash;
    bytes32 public immutable createDistributionVerifierCodeHash;
    bytes32 public immutable claimVerifierCodeHash;
    bytes32 public immutable withdrawVerifierCodeHash;

    IncrementalTree.Tree private notes;
    IncrementalTree.Tree private distributions;
    mapping(uint256 => bool) public spentNoteNullifier;
    mapping(uint256 => bool) public spentClaimNullifier;
    mapping(uint256 => bool) public insertedDistribution;
    uint256 private entered;

    struct EnvelopeV1 { bytes ephemeralPubKey; bytes1 viewTag; bytes ciphertext; }

    event Shielded(uint256 indexed noteCommitment, uint256 indexed noteIndex, uint64 amount);
    event NoteInserted(uint256 indexed noteCommitment, uint256 indexed noteIndex, uint256 postNoteRoot, uint8 noteType);
    event DistributionInserted(uint256 indexed distributionCommitment, uint256 indexed distributionIndex,
        uint256 postDistributionRoot, bytes32 envelopeRoot, bytes32 transportTag, uint8 version);
    event EnvelopePublished(bytes32 indexed transportTag, uint8 indexed slot, uint8 version,
        bytes ephemeralPubKey, bytes1 viewTag, bytes ciphertext);
    event AllocationConsumed(uint256 indexed claimNullifier, uint256 indexed noteCommitment,
        uint256 noteIndex, uint256 postNoteRoot, uint8 version);
    event Withdrawn(uint256 indexed noteNullifier, address indexed recipient, uint64 amount);

    error InvalidDependency();
    error InvalidPublicInputs();
    error InvalidField();
    error ContextMismatch();
    error RootStale();
    error ProofInvalid();
    error NullifierSpent();
    error IntentExpired();
    error EnvelopeInvalid();
    error DistributionAlreadyInserted();
    error PolicyNotRegistered();
    error TransferFailed();
    error ReentrantCall();

    modifier nonReentrant() {
        if (entered != 0) revert ReentrantCall();
        entered = 1;
        _;
        entered = 0;
    }

    constructor(IERC20 asset, IPoseidon3 hasher, NullAuthRegistry registry,
        IVerifier shieldProofVerifier, IVerifier distributionProofVerifier, IVerifier claimProofVerifier,
        IVerifier withdrawProofVerifier)
    {
        if (address(asset).code.length == 0 || address(hasher).code.length == 0 ||
            address(registry).code.length == 0 || address(shieldProofVerifier).code.length == 0 ||
            address(distributionProofVerifier).code.length == 0 || address(claimProofVerifier).code.length == 0 ||
            address(withdrawProofVerifier).code.length == 0)
            revert InvalidDependency();
        if (asset.decimals() != 6 || address(registry.HASHER()) != address(hasher)) revert InvalidDependency();
        ASSET = asset;
        HASHER = hasher;
        AUTH_REGISTRY = registry;
        shieldVerifier = shieldProofVerifier;
        createDistributionVerifier = distributionProofVerifier;
        claimVerifier = claimProofVerifier;
        withdrawVerifier = withdrawProofVerifier;
        shieldVerifierCodeHash = address(shieldProofVerifier).codehash;
        createDistributionVerifierCodeHash = address(distributionProofVerifier).codehash;
        claimVerifierCodeHash = address(claimProofVerifier).codehash;
        withdrawVerifierCodeHash = address(withdrawProofVerifier).codehash;
        notes.initialize(hasher);
        distributions.initialize(hasher);
    }

    /// @dev Inputs: version, chain, pool, amount, treasuryBody, authPolicy.
    /// A proof is essential: accepting an arbitrary body would permit hidden-value inflation.
    function shield(bytes calldata proof, bytes32[] calldata inputs) external nonReentrant {
        _context(inputs, 6);
        uint256 amount = uint256(inputs[3]);
        if (amount == 0 || amount > type(uint64).max) revert InvalidPublicInputs();
        if (!AUTH_REGISTRY.registered(uint256(inputs[5]))) revert PolicyNotRegistered();
        _verify(shieldVerifier, shieldVerifierCodeHash, proof, inputs);
        uint256 balanceBefore = ASSET.balanceOf(address(this));
        (bool ok, bytes memory result) = address(ASSET).call(
            abi.encodeCall(IERC20.transferFrom, (msg.sender, address(this), amount))
        );
        if (!ok || (result.length != 0 && (result.length != 32 || !abi.decode(result, (bool))))) revert TransferFailed();
        if (ASSET.balanceOf(address(this)) != balanceBefore + amount) revert TransferFailed();
        (uint256 commitment, uint256 index,) = _insertNote(uint256(inputs[4]), 0);
        emit Shielded(commitment, index, uint64(amount));
    }

    /// @dev Public inputs follow circuits/create_distribution/src/main.nr exactly.
    function createDistribution(bytes calldata proof, bytes32[] calldata inputs, EnvelopeV1[8] calldata envelopes)
        external nonReentrant
    {
        _context(inputs, 15);
        _deadline(inputs[14]);
        if (!notes.known(uint256(inputs[3])) || !AUTH_REGISTRY.isKnownAuthRoot(uint256(inputs[4]))) revert RootStale();
        uint256 nullifier0 = uint256(inputs[5]);
        uint256 nullifier1 = uint256(inputs[6]);
        if (nullifier0 == 0 || nullifier1 == 0 || nullifier0 == nullifier1) revert InvalidPublicInputs();
        if (spentNoteNullifier[nullifier0] || spentNoteNullifier[nullifier1]) revert NullifierSpent();
        uint256 commitment = uint256(inputs[7]);
        if (insertedDistribution[commitment]) revert DistributionAlreadyInserted();
        bytes32 envelopeRoot = _join128(inputs[8], inputs[9]);
        bytes32 tag = _join128(inputs[11], inputs[12]);
        if (_envelopeRoot(envelopes, tag) != envelopeRoot) revert EnvelopeInvalid();
        _verify(createDistributionVerifier, createDistributionVerifierCodeHash, proof, inputs);
        spentNoteNullifier[nullifier0] = true;
        spentNoteNullifier[nullifier1] = true;
        insertedDistribution[commitment] = true;
        // Always append the change commitment, even when its hidden amount is zero.
        _insertNote(uint256(inputs[10]), 0);
        (uint256 index, uint256 root) = distributions.insert(HASHER, commitment);
        emit DistributionInserted(commitment, index, root, envelopeRoot, tag, 1);
        for (uint8 slot; slot < 8; ++slot) {
            emit EnvelopePublished(tag, slot, 1, envelopes[slot].ephemeralPubKey,
                envelopes[slot].viewTag, envelopes[slot].ciphertext);
        }
    }

    /// @dev Inputs: version, chain, pool, globalDistributionRoot, nullifier, body, nonce, validUntil.
    /// No allocation root, distribution identifier, transport tag, key or amount is published.
    function claim(bytes calldata proof, bytes32[] calldata inputs) external nonReentrant {
        _context(inputs, 8);
        _deadline(inputs[7]);
        if (!distributions.known(uint256(inputs[3]))) revert RootStale();
        uint256 nullifier = uint256(inputs[4]);
        if (nullifier == 0) revert InvalidPublicInputs();
        if (spentClaimNullifier[nullifier]) revert NullifierSpent();
        _verify(claimVerifier, claimVerifierCodeHash, proof, inputs);
        spentClaimNullifier[nullifier] = true;
        (uint256 commitment, uint256 index, uint256 root) = _insertNote(uint256(inputs[5]), 1);
        emit AllocationConsumed(nullifier, commitment, index, root, 1);
    }

    /// @notice Withdraw one whole note; the proof hides which note is spent.
    /// @dev Destination and amount are public and bound to the proof. Treasury exits
    /// additionally require the registered organization's hidden ECDSA approval.
    function withdraw(bytes calldata proof, bytes32[] calldata inputs) external nonReentrant {
        _context(inputs, 10);
        _deadline(inputs[9]);
        if (!notes.known(uint256(inputs[3])) || !AUTH_REGISTRY.isKnownAuthRoot(uint256(inputs[4]))) revert RootStale();
        uint256 nullifier = uint256(inputs[5]);
        uint256 destination = uint256(inputs[6]);
        uint256 amount = uint256(inputs[7]);
        if (nullifier == 0 || destination == 0 || destination > type(uint160).max ||
            address(uint160(destination)) == address(this) || amount == 0 || amount > type(uint64).max)
            revert InvalidPublicInputs();
        if (spentNoteNullifier[nullifier]) revert NullifierSpent();
        _verify(withdrawVerifier, withdrawVerifierCodeHash, proof, inputs);
        address recipient = address(uint160(destination));
        uint256 poolBefore = ASSET.balanceOf(address(this));
        uint256 recipientBefore = ASSET.balanceOf(recipient);
        spentNoteNullifier[nullifier] = true;
        (bool ok, bytes memory result) = address(ASSET).call(abi.encodeCall(IERC20.transfer, (recipient, amount)));
        if (!ok || (result.length != 0 && (result.length != 32 || !abi.decode(result, (bool))))) revert TransferFailed();
        if (ASSET.balanceOf(address(this)) + amount != poolBefore ||
            ASSET.balanceOf(recipient) != recipientBefore + amount) revert TransferFailed();
        emit Withdrawn(nullifier, recipient, uint64(amount));
    }

    function noteRoot() external view returns (uint256) { return notes.root; }
    function distributionRoot() external view returns (uint256) { return distributions.root; }
    function nextNoteIndex() external view returns (uint256) { return notes.count; }
    function nextDistributionIndex() external view returns (uint256) { return distributions.count; }
    function isKnownNoteRoot(uint256 root) external view returns (bool) { return notes.known(root); }
    function isKnownDistributionRoot(uint256 root) external view returns (bool) { return distributions.known(root); }

    function _insertNote(uint256 body, uint8 noteType)
        private returns (uint256 commitment, uint256 index, uint256 root)
    {
        if (body == 0 || body >= FIELD) revert InvalidField();
        commitment = HASHER.poseidon([Domains.FINAL_NOTE, body, notes.count]);
        (index, root) = notes.insert(HASHER, commitment);
        emit NoteInserted(commitment, index, root, noteType);
    }

    function _context(bytes32[] calldata inputs, uint256 expected) private view {
        if (inputs.length != expected) revert InvalidPublicInputs();
        for (uint256 i; i < expected; ++i) if (uint256(inputs[i]) >= FIELD) revert InvalidField();
        if (uint256(inputs[0]) != PROTOCOL_VERSION || uint256(inputs[1]) != block.chainid ||
            uint256(inputs[2]) != uint256(uint160(address(this)))) revert ContextMismatch();
    }

    function _deadline(bytes32 value) private view {
        uint256 deadline = uint256(value);
        if (deadline == 0 || deadline > type(uint64).max || block.timestamp > deadline) revert IntentExpired();
    }

    function _verify(IVerifier verifier, bytes32 codeHash, bytes calldata proof, bytes32[] calldata inputs) private view {
        if (address(verifier).codehash != codeHash || proof.length == 0) revert ProofInvalid();
        try verifier.verify(proof, inputs) returns (bool valid) {
            if (!valid) revert ProofInvalid();
        } catch { revert ProofInvalid(); }
    }

    function _join128(bytes32 hi, bytes32 lo) private pure returns (bytes32) {
        if (uint256(hi) > type(uint128).max || uint256(lo) > type(uint128).max) revert InvalidPublicInputs();
        return bytes32((uint256(hi) << 128) | uint256(lo));
    }

    function _envelopeRoot(EnvelopeV1[8] calldata envelopes, bytes32 tag) private pure returns (bytes32) {
        bytes32[8] memory nodes;
        for (uint8 slot; slot < 8; ++slot) {
            EnvelopeV1 calldata envelope = envelopes[slot];
            if (envelope.ephemeralPubKey.length != 33 || envelope.ciphertext.length != CIPHERTEXT_BYTES)
                revert EnvelopeInvalid();
            if (envelope.ephemeralPubKey[0] != 0x02 && envelope.ephemeralPubKey[0] != 0x03) revert EnvelopeInvalid();
            nodes[slot] = keccak256(abi.encodePacked(uint8(1), slot, tag,
                envelope.ephemeralPubKey, envelope.viewTag, envelope.ciphertext));
        }
        for (uint256 width = 8; width > 1; width /= 2) {
            for (uint256 i; i < width / 2; ++i) {
                nodes[i] = keccak256(abi.encodePacked("null.v1.envelope-merkle", nodes[2 * i], nodes[2 * i + 1]));
            }
        }
        return nodes[0];
    }
}
