import {
  type Hex, NullError, assertAmount, assertField, bigintToBytes, bytesToBigInt, deriveField,
  fieldFromHex, fieldHex, fromHex, hashFields, secp256k1, split128, utf8,
} from '@null-protocol/crypto';
import {
  type AllocationV1, type ChainContext, type MerklePath, TREE_DEPTH, allocationLeaf,
  claimIntentDigest, claimNullifier, deriveNoteSecrets, distributionCommitment, distributionIntentDigest,
  envelopeRoot, finalNoteCommitment, merkleRoot8, noteNullifier, privateNoteBody, publicKeyCommitment,
  rootFromPath, treasuryNoteBody, validateContext,
} from '@null-protocol/protocol';
import type { CompiledDistribution, DiscoveredAllocation, PrivateNoteDraft } from './index';

export type NoirInput = string | number | boolean | NoirInput[] | { [key: string]: NoirInput };
export type NoirWitness = Record<string, NoirInput>;
export interface PreparedWitness { publicInputs: Hex[]; witness: NoirWitness }
export interface AuthPolicyOpening { signerPublicKey: Hex; policyMetadata: bigint; registrationBlinder: bigint }
export interface TreasuryNoteOpening { ownerNullifierKey: bigint; amountAtomic: bigint; noteSecret: bigint; path: MerklePath }

function nonzeroField(value: bigint): bigint {
  if (assertField(value) === 0n) throw new NullError('NULL_WITNESS_INVALID', 'Secret field elements must be nonzero.');
  return value;
}
function validateDeadline(nonce: bigint, validUntil: bigint): void { nonzeroField(nonce); assertAmount(validUntil); }
function contextFields(context: ChainContext): bigint[] {
  validateContext(context);
  if (bytesToBigInt(fromHex(context.poolAddress, 20)) === 0n) throw new NullError('NULL_CONTEXT_MISMATCH', 'Proofs require a deployed pool address.');
  return [1n, context.chainId, bytesToBigInt(fromHex(context.poolAddress, 20))];
}
function keyCoordinates(publicKey: Hex): { x: number[]; y: number[] } {
  const key = secp256k1.ProjectivePoint.fromHex(fromHex(publicKey)).toRawBytes(false);
  return { x: [...key.slice(1, 33)], y: [...key.slice(33)] };
}
function allocationInput(allocation: AllocationV1): NoirInput {
  const publicKey = keyCoordinates(allocation.stealthPublicKey); allocationLeaf(allocation); nonzeroField(allocation.leafSalt);
  return { public_key_x: publicKey.x, public_key_y: publicKey.y, amount: allocation.amountAtomic.toString(), leaf_salt: allocation.leafSalt.toString(), is_real: allocation.flags === 1 };
}
function assertPath(path: MerklePath, leaf: Hex): void {
  if (path.siblings.length !== TREE_DEPTH || rootFromPath(leaf, path.index, path.siblings) !== path.root) throw new NullError('NULL_PATH_INVALID', 'A valid 20-level accumulator path is required.');
}
export function authPolicyCommitment(opening: AuthPolicyOpening): Hex {
  return fieldHex(hashFields('null.v1.auth-policy', [publicKeyCommitment(opening.signerPublicKey), assertField(opening.policyMetadata), nonzeroField(opening.registrationBlinder)]));
}
/** Public deposit amount and policy are bound to the hidden treasury note body. */
export function buildShieldWitness(options: { context: ChainContext; amountAtomic: bigint; ownerNullifierKey: bigint; noteSecret: bigint; policyCommitment: Hex }): PreparedWitness & { bodyCommitment: Hex } {
  nonzeroField(options.ownerNullifierKey); nonzeroField(options.noteSecret); nonzeroField(fieldFromHex(options.policyCommitment));
  const bodyCommitment = treasuryNoteBody(options.ownerNullifierKey, options.policyCommitment, assertAmount(options.amountAtomic), options.noteSecret);
  const publicInputs = [...contextFields(options.context), options.amountAtomic, fieldFromHex(bodyCommitment), fieldFromHex(options.policyCommitment)].map(fieldHex);
  return { publicInputs, bodyCommitment, witness: { inputs: publicInputs, owner_nullifier_key: options.ownerNullifierKey.toString(), note_secret: options.noteSecret.toString() } };
}

export interface PrepareDistributionOptions {
  compiled: CompiledDistribution; context: ChainContext; treasuryInputs: readonly TreasuryNoteOpening[];
  authPolicy: AuthPolicyOpening; policyPath: MerklePath; changeOwnerNullifierKey: bigint; changeNoteSecret: bigint;
  nonce: bigint; validUntil: bigint;
}
export interface PreparedDistributionIntent extends PreparedWitness {
  digest: Hex; changeAmountAtomic: bigint; changeBodyCommitment: Hex; policyCommitment: Hex;
}
/** Build the exact 15-field intent before requesting the business wallet's raw hash signature. */
export function prepareDistributionIntent(options: PrepareDistributionOptions): PreparedDistributionIntent {
  const { compiled, treasuryInputs, context } = options;
  validateDeadline(options.nonce, options.validUntil); nonzeroField(options.changeOwnerNullifierKey); nonzeroField(options.changeNoteSecret);
  if (compiled.publicBundle.chainId !== context.chainId.toString() || compiled.publicBundle.poolAddress.toLowerCase() !== context.poolAddress.toLowerCase()) throw new NullError('NULL_CONTEXT_MISMATCH', 'Compiled distribution targets a different pool.');
  if (treasuryInputs.length < 1 || treasuryInputs.length > 2 || compiled.allocations.length !== 8) throw new NullError('NULL_WITNESS_INVALID', 'A distribution requires one or two treasury notes and eight allocations.');
  const sorted = [...compiled.allocations].sort((a, b) => a.slot - b.slot);
  if (sorted.some((allocation, index) => allocation.slot !== index)) throw new NullError('NULL_WITNESS_INVALID', 'Invalid allocation slot order.');
  const allocationRoot = merkleRoot8(sorted.map(allocationLeaf));
  const encryptedRoot = envelopeRoot(compiled.envelopes);
  const commitment = distributionCommitment(allocationRoot, encryptedRoot, compiled.transportTag);
  if (commitment !== compiled.commitment || allocationRoot !== compiled.allocationRoot || encryptedRoot !== compiled.envelopeRoot) throw new NullError('NULL_CRE_COMPILE_MISMATCH', 'The compiled distribution was changed after preparation.');
  const policy = authPolicyCommitment(options.authPolicy); assertPath(options.policyPath, policy);
  const noteRoot = treasuryInputs[0]!.path.root;
  const inputNullifiers: Hex[] = [];
  let total = 0n;
  const noteInputs: NoirInput[] = treasuryInputs.map(note => {
    nonzeroField(note.ownerNullifierKey); nonzeroField(note.noteSecret); assertAmount(note.amountAtomic);
    const body = treasuryNoteBody(note.ownerNullifierKey, policy, note.amountAtomic, note.noteSecret);
    const commitment = finalNoteCommitment(body, note.path.index); assertPath(note.path, commitment);
    if (note.path.root !== noteRoot) throw new NullError('NULL_ROOT_STALE', 'Treasury notes must use the same accepted root.');
    inputNullifiers.push(noteNullifier(commitment, note.ownerNullifierKey)); total += note.amountAtomic;
    return { is_real: true, owner_nullifier_key: note.ownerNullifierKey.toString(), amount: note.amountAtomic.toString(), note_secret: note.noteSecret.toString(), leaf_index: note.path.index, siblings: note.path.siblings };
  });
  if (treasuryInputs.length === 1) {
    const phantomOwner = deriveField(bigintToBytes(treasuryInputs[0]!.ownerNullifierKey), utf8(`null.v1.phantom/${options.nonce}`));
    inputNullifiers.push(fieldHex(hashFields('null.v1.phantom-nullifier', [phantomOwner, options.nonce, 1n, fieldFromHex(policy)])));
    noteInputs.push({ is_real: false, owner_nullifier_key: phantomOwner.toString(), amount: '0', note_secret: '0', leaf_index: 0, siblings: Array.from({ length: TREE_DEPTH }, () => '0') });
  }
  if (inputNullifiers[0] === inputNullifiers[1] || inputNullifiers.some(value => fieldFromHex(value) === 0n)) throw new NullError('NULL_WITNESS_INVALID', 'Treasury inputs must have distinct nonzero nullifiers.');
  const allocated = sorted.reduce((sum, allocation) => sum + allocation.amountAtomic, 0n);
  const changeAmountAtomic = total - allocated; assertAmount(changeAmountAtomic, true);
  const changeBodyCommitment = treasuryNoteBody(options.changeOwnerNullifierKey, policy, changeAmountAtomic, options.changeNoteSecret);
  const publicInputs = [
    ...contextFields(context), fieldFromHex(noteRoot), fieldFromHex(options.policyPath.root), ...inputNullifiers.map(fieldFromHex), fieldFromHex(commitment),
    ...split128(fromHex(encryptedRoot, 32)), fieldFromHex(changeBodyCommitment), ...split128(fromHex(compiled.transportTag, 32)), options.nonce, options.validUntil,
  ].map(fieldHex);
  const key = keyCoordinates(options.authPolicy.signerPublicKey);
  const witness: NoirWitness = {
    inputs: publicInputs, treasury_inputs: noteInputs, allocations: sorted.map(allocationInput), signer_public_key_x: key.x, signer_public_key_y: key.y,
    policy_metadata: options.authPolicy.policyMetadata.toString(), registration_blinder: options.authPolicy.registrationBlinder.toString(),
    policy_index: options.policyPath.index, policy_siblings: options.policyPath.siblings,
    change_owner_nullifier_key: options.changeOwnerNullifierKey.toString(), change_amount: changeAmountAtomic.toString(), change_note_secret: options.changeNoteSecret.toString(),
  };
  return { publicInputs, witness, digest: distributionIntentDigest(publicInputs), changeAmountAtomic, changeBodyCommitment, policyCommitment: policy };
}
export function buildCreateDistributionWitness(options: PrepareDistributionOptions & { signerSignature: Hex }): PreparedDistributionIntent {
  const prepared = prepareDistributionIntent(options); const signature = fromHex(options.signerSignature, 64);
  if (!secp256k1.verify(signature, fromHex(prepared.digest), fromHex(options.authPolicy.signerPublicKey), { lowS: true, prehash: false })) throw new NullError('NULL_PRIVY_AUTH_FAILED', 'The business signature does not authorize this exact distribution.');
  return { ...prepared, witness: { ...prepared.witness, signer_signature: [...signature] } };
}

/** CLIENT ONLY. A confirmed public accumulator path is required; local rehearsal allocations are rejected. */
export function buildClaimWitness(options: { allocation: DiscoveredAllocation; distributionPath: MerklePath; nonce: bigint; validUntil: bigint }): PreparedWitness & { note: PrivateNoteDraft; signature: Hex } {
  const { allocation, distributionPath } = options;
  if (allocation.source !== 'chain' || !allocation.confirmed) throw new NullError('NULL_DISTRIBUTION_UNCONFIRMED', 'Confirm the distribution onchain before creating a claim proof.');
  validateDeadline(options.nonce, options.validUntil);
  const leaf = allocationLeaf({ ...allocation, flags: 1 });
  if (leaf !== allocation.allocationLeaf || allocation.allocationPath.length !== 3 || rootFromPath(leaf, allocation.slot, allocation.allocationPath) !== allocation.allocationRoot) throw new NullError('NULL_PATH_INVALID', 'The allocation commitment or path is invalid.');
  const commitment = distributionCommitment(allocation.allocationRoot, allocation.envelopeRoot, allocation.transportTag);
  if (commitment !== allocation.distributionCommitment) throw new NullError('NULL_CONTEXT_MISMATCH', 'The private distribution commitment is invalid.');
  assertPath(distributionPath, commitment);
  const secrets = deriveNoteSecrets(allocation.stealthPrivateKey, allocation.context, commitment, leaf);
  const bodyCommitment = privateNoteBody(secrets.ownerNullifierKey, allocation.amountAtomic, secrets.noteSecret);
  const nullifier = claimNullifier(commitment, leaf);
  const publicInputs = [...contextFields(allocation.context), fieldFromHex(distributionPath.root), fieldFromHex(nullifier), fieldFromHex(bodyCommitment), options.nonce, options.validUntil].map(fieldHex);
  const signature = secp256k1.sign(fromHex(claimIntentDigest(publicInputs)), allocation.stealthPrivateKey, { lowS: true, prehash: false }).toCompactRawBytes();
  if (!secp256k1.verify(signature, fromHex(claimIntentDigest(publicInputs)), fromHex(allocation.stealthPublicKey), { lowS: true, prehash: false })) throw new NullError('NULL_PROFILE_INVALID', 'The one-time key does not control this allocation.');
  const [envelopeHi, envelopeLo] = split128(fromHex(allocation.envelopeRoot, 32));
  const [tagHi, tagLo] = split128(fromHex(allocation.transportTag, 32));
  return {
    publicInputs, signature: `0x${Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('')}`,
    note: { ...secrets, amountAtomic: allocation.amountAtomic, bodyCommitment, claimNullifier: nullifier },
    witness: { inputs: publicInputs, allocation: allocationInput({ ...allocation, flags: 1 }), allocation_index: allocation.slot, allocation_siblings: allocation.allocationPath,
      envelope_root_hi: envelopeHi.toString(), envelope_root_lo: envelopeLo.toString(), transport_tag_hi: tagHi.toString(), transport_tag_lo: tagLo.toString(),
      distribution_index: distributionPath.index, distribution_siblings: distributionPath.siblings, stealth_signature: [...signature],
      owner_nullifier_key: secrets.ownerNullifierKey.toString(), note_secret: secrets.noteSecret.toString(),
    },
  };
}
export interface WithdrawWitnessOptions {
  context: ChainContext; note: TreasuryNoteOpening; recipient: Hex; authRoot: Hex;
  authPolicy?: AuthPolicyOpening; policyPath?: MerklePath; nonce: bigint; validUntil: bigint;
}
export interface PartialWithdrawalWitnessOptions {
  context: ChainContext; note: TreasuryNoteOpening; recipient: Hex; authRoot: Hex;
  amountAtomic: bigint; changeOwnerNullifierKey: bigint; changeNoteSecret: bigint;
  nonce: bigint; validUntil: bigint;
}
/** Recipient-only partial exit. Requires a separately deployed partial-withdrawal verifier. */
export function buildPartialWithdrawalWitness(options: PartialWithdrawalWitnessOptions): PreparedWitness & { changeBodyCommitment: Hex; changeAmountAtomic: bigint } {
  validateDeadline(options.nonce, options.validUntil);
  const { note } = options;
  assertAmount(note.amountAtomic); assertAmount(options.amountAtomic);
  if (options.amountAtomic >= note.amountAtomic) throw new NullError('NULL_AMOUNT_INVALID', 'A partial withdrawal must leave a positive private balance. Use a full withdrawal for the entire note.');
  const recipient = bytesToBigInt(fromHex(options.recipient, 20));
  if (!recipient || recipient === BigInt(options.context.poolAddress)) throw new NullError('NULL_DESTINATION_INVALID', 'Choose a receiving wallet other than the pool.');
  const body = privateNoteBody(note.ownerNullifierKey, note.amountAtomic, note.noteSecret);
  const commitment = finalNoteCommitment(body, note.path.index); assertPath(note.path, commitment);
  const changeAmountAtomic = note.amountAtomic - options.amountAtomic;
  const changeBodyCommitment = privateNoteBody(options.changeOwnerNullifierKey, changeAmountAtomic, options.changeNoteSecret);
  const publicInputs = [...contextFields(options.context), fieldFromHex(note.path.root), fieldFromHex(options.authRoot),
    fieldFromHex(noteNullifier(commitment, note.ownerNullifierKey)), recipient, options.amountAtomic,
    fieldFromHex(changeBodyCommitment), options.nonce, options.validUntil].map(fieldHex);
  return { publicInputs, changeBodyCommitment, changeAmountAtomic, witness: {
    inputs: publicInputs, owner_nullifier_key: note.ownerNullifierKey.toString(), note_secret: note.noteSecret.toString(),
    note_amount: note.amountAtomic.toString(), leaf_index: note.path.index, note_siblings: note.path.siblings,
    change_owner_nullifier_key: nonzeroField(options.changeOwnerNullifierKey).toString(), change_note_secret: nonzeroField(options.changeNoteSecret).toString(),
  } };
}
export function withdrawalIntentDigest(inputs: readonly Hex[]): Hex {
  if (inputs.length !== 10) throw new NullError('NULL_INTENT_INVALID', 'Withdrawal requires ten public fields.');
  return fieldHex(hashFields('null.v1.withdraw-intent', inputs.map(fieldFromHex)));
}
/** Full-note withdrawal avoids lost change and requires the original note opening. */
export function prepareWithdrawalIntent(options: WithdrawWitnessOptions): PreparedWitness & { digest: Hex; bodyCommitment: Hex } {
  validateDeadline(options.nonce, options.validUntil);
  const { note, authPolicy } = options;
  nonzeroField(note.ownerNullifierKey); nonzeroField(note.noteSecret); assertAmount(note.amountAtomic);
  const recipient = bytesToBigInt(fromHex(options.recipient, 20));
  if (!recipient || recipient === BigInt(options.context.poolAddress)) throw new NullError('NULL_DESTINATION_INVALID', 'Choose a receiving wallet other than the pool.');
  const policy = authPolicy ? authPolicyCommitment(authPolicy) : undefined;
  if (policy) {
    if (!options.policyPath || options.policyPath.root !== options.authRoot) throw new NullError('NULL_PATH_INVALID', 'Organization authorization history is required.');
    assertPath(options.policyPath, policy);
  }
  const bodyCommitment = policy ? treasuryNoteBody(note.ownerNullifierKey, policy, note.amountAtomic, note.noteSecret) : privateNoteBody(note.ownerNullifierKey, note.amountAtomic, note.noteSecret);
  const commitment = finalNoteCommitment(bodyCommitment, note.path.index); assertPath(note.path, commitment);
  const publicInputs = [...contextFields(options.context), fieldFromHex(note.path.root), fieldFromHex(options.authRoot), fieldFromHex(noteNullifier(commitment, note.ownerNullifierKey)), recipient, note.amountAtomic, options.nonce, options.validUntil].map(fieldHex);
  const key = authPolicy ? keyCoordinates(authPolicy.signerPublicKey) : { x: Array(32).fill(0), y: Array(32).fill(0) };
  return { publicInputs, digest: withdrawalIntentDigest(publicInputs), bodyCommitment, witness: {
    inputs: publicInputs, is_treasury: !!authPolicy, owner_nullifier_key: note.ownerNullifierKey.toString(), note_secret: note.noteSecret.toString(), leaf_index: note.path.index, note_siblings: note.path.siblings,
    signer_public_key_x: key.x, signer_public_key_y: key.y, policy_metadata: authPolicy?.policyMetadata.toString() ?? '0', registration_blinder: authPolicy?.registrationBlinder.toString() ?? '0',
    policy_index: options.policyPath?.index ?? 0, policy_siblings: options.policyPath?.siblings ?? Array(20).fill('0'), signer_signature: Array(64).fill(0),
  } };
}
export function buildWithdrawalWitness(options: WithdrawWitnessOptions & { signerSignature?: Hex }): ReturnType<typeof prepareWithdrawalIntent> {
  const built = prepareWithdrawalIntent(options);
  if (!options.authPolicy) return built;
  if (!options.signerSignature) throw new NullError('NULL_PRIVY_AUTH_FAILED', 'Organization approval is required to withdraw treasury funds.');
  const signature = fromHex(options.signerSignature, 64);
  if (!secp256k1.verify(signature, fromHex(built.digest), fromHex(options.authPolicy.signerPublicKey), {lowS:true,prehash:false})) throw new NullError('NULL_PRIVY_AUTH_FAILED', 'The organization did not authorize this withdrawal.');
  return {...built,witness:{...built.witness,signer_signature:[...signature]}};
}
