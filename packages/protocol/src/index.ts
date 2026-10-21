import {
  type Hex, type ProfileKeys, NullError, assertAmount, assertField, bigintToBytes, bytesToBigInt, concatBytes,
  deriveField, equalBytes, fieldFromHex, fieldHex, fromHex, hashFields, hkdf, keccak_256,
  recoverStealthDelivery, secp256k1, sha256, split128, toHex, utf8,
} from '@null-protocol/crypto';

export const PROTOCOL_VERSION = 1 as const;
export const DISTRIBUTION_SLOTS = 8;
export const ENVELOPE_PLAINTEXT_BYTES = 512;
export const ENVELOPE_CIPHERTEXT_BYTES = 540;
export const ENVELOPE_SERIALIZED_BYTES = 608;
export const TREE_DEPTH = 20;
export interface ChainContext { chainId: bigint; poolAddress: Hex }
export interface EnvelopeV1 { version: 1; slot: number; transportTag: Hex; ephemeralPubKey: Hex; viewTag: Hex; ciphertext: Hex }
export interface DistributionRecord {
  commitment: Hex; envelopeRoot: Hex; transportTag: Hex; expiry?: string;
  blockNumber?: bigint; leafIndex?: number; confirmed?: boolean;
}
export interface AllocationV1 {
  stealthPublicKey: Hex; amountAtomic: bigint; leafSalt: bigint; flags: 0 | 1;
}
export interface EnvelopePlaintextV1 extends AllocationV1 {
  slot: number; context: ChainContext; transportTag: Hex; allocationRoot: Hex;
  allocationPath: readonly Hex[]; distributionLeafHint: bigint;
}
export type EncryptionProvider = (key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array) => Promise<Uint8Array>;
export interface MerklePath { index: number; siblings: Hex[]; root: Hex }
export function validateContext(context: ChainContext): void {
  if (context.chainId <= 0n || context.chainId > (1n << 64n) - 1n) throw new NullError('NULL_CONTEXT_MISMATCH', 'Chain ID must fit within 64 bits.');
  fromHex(context.poolAddress, 20);
}
export function publicKeyCommitment(publicKey: Hex): bigint {
  const point = secp256k1.ProjectivePoint.fromHex(fromHex(publicKey)); point.assertValidity();
  const uncompressed = point.toRawBytes(false);
  return hashFields('null.v1.pk', [...split128(uncompressed.slice(1, 33)), ...split128(uncompressed.slice(33))]);
}
export function allocationLeaf(allocation: AllocationV1): Hex {
  if (allocation.flags !== 0 && allocation.flags !== 1) throw new NullError('NULL_ALLOCATION_INVALID', 'Invalid allocation flags.');
  assertAmount(allocation.amountAtomic, allocation.flags === 0);
  if (allocation.flags === 0 && allocation.amountAtomic !== 0n) throw new NullError('NULL_ALLOCATION_INVALID', 'Dummy allocations must be empty.');
  if (assertField(allocation.leafSalt) === 0n) throw new NullError('NULL_ALLOCATION_INVALID', 'Allocation salts must be nonzero.');
  return fieldHex(hashFields('null.v1.allocation', [publicKeyCommitment(allocation.stealthPublicKey), allocation.amountAtomic, assertField(allocation.leafSalt), BigInt(allocation.flags)]));
}
export function merkleParent(left: Hex, right: Hex): Hex { return fieldHex(hashFields('null.v1.merkle', [fieldFromHex(left), fieldFromHex(right)])); }
export function merkleRoot8(leaves: readonly Hex[]): Hex {
  if (leaves.length !== 8) throw new NullError('NULL_SLOT_COUNT_INVALID', 'A distribution must have exactly eight slots.');
  let nodes = leaves.slice(); nodes.forEach(fieldFromHex);
  while (nodes.length > 1) { const next: Hex[] = []; for (let i = 0; i < nodes.length; i += 2) next.push(merkleParent(nodes[i]!, nodes[i + 1]!)); nodes = next; }
  return nodes[0]!;
}
export function merklePath8(leaves: readonly Hex[], index: number): MerklePath {
  if (!Number.isInteger(index) || index < 0 || index >= 8 || leaves.length !== 8) throw new NullError('NULL_PATH_INVALID', 'Invalid allocation position.');
  const siblings: Hex[] = []; let position = index; let nodes = leaves.slice();
  while (nodes.length > 1) {
    siblings.push(nodes[position ^ 1]!); const next: Hex[] = [];
    for (let i = 0; i < nodes.length; i += 2) next.push(merkleParent(nodes[i]!, nodes[i + 1]!));
    nodes = next; position = Math.floor(position / 2);
  }
  return { index, siblings, root: nodes[0]! };
}
export function rootFromPath(leaf: Hex, index: number, siblings: readonly Hex[]): Hex {
  if (!Number.isInteger(index) || index < 0 || index >= 2 ** siblings.length || siblings.length > TREE_DEPTH) throw new NullError('NULL_PATH_INVALID', 'Invalid Merkle position.');
  let root = leaf; let position = index;
  for (const sibling of siblings) { root = position % 2 === 0 ? merkleParent(root, sibling) : merkleParent(sibling, root); position = Math.floor(position / 2); }
  return root;
}

/** Rebuilds the same fixed-depth append-only tree used by the pool. */
export class IncrementalMerkleTree {
  readonly depth: number;
  readonly leaves: Hex[] = [];
  private readonly zeroes: Hex[];
  constructor(depth = TREE_DEPTH, leaves: readonly Hex[] = []) {
    if (!Number.isInteger(depth) || depth < 1 || depth > TREE_DEPTH) throw new NullError('NULL_PATH_INVALID', 'Invalid tree depth.');
    this.depth = depth; this.zeroes = [fieldHex(0n)];
    for (let level = 1; level <= depth; level++) this.zeroes.push(merkleParent(this.zeroes[level - 1]!, this.zeroes[level - 1]!));
    for (const leaf of leaves) this.append(leaf);
  }
  append(leaf: Hex): number {
    fieldFromHex(leaf);
    if (this.leaves.length >= 2 ** this.depth) throw new NullError('NULL_TREE_FULL', 'The accumulator is full.');
    this.leaves.push(leaf); return this.leaves.length - 1;
  }
  get root(): Hex { return this.pathForPosition(0).root; }
  getPath(index: number): MerklePath {
    if (index < 0 || index >= this.leaves.length || !Number.isInteger(index)) throw new NullError('NULL_PATH_INVALID', 'Leaf has not been inserted.');
    return this.pathForPosition(index);
  }
  private pathForPosition(index: number): MerklePath {
    let nodes = this.leaves.slice(); let position = index; const siblings: Hex[] = [];
    for (let level = 0; level < this.depth; level++) {
      siblings.push(nodes[position ^ 1] ?? this.zeroes[level]!);
      const next: Hex[] = [];
      for (let i = 0; i < Math.max(nodes.length, 1); i += 2) next.push(merkleParent(nodes[i] ?? this.zeroes[level]!, nodes[i + 1] ?? this.zeroes[level]!));
      nodes = next; position = Math.floor(position / 2);
    }
    return { index, siblings, root: nodes[0] ?? this.zeroes[this.depth]! };
  }
}

export function envelopeAAD(envelope: Pick<EnvelopeV1, 'slot' | 'transportTag' | 'version'>, context: ChainContext): Uint8Array {
  validateContext(context);
  if (envelope.version !== 1 || !Number.isInteger(envelope.slot) || envelope.slot < 0 || envelope.slot >= 8) throw new NullError('NULL_ENVELOPE_INVALID', 'Invalid envelope context.');
  return concatBytes(utf8('NULL'), new Uint8Array([1]), bigintToBytes(context.chainId, 8), fromHex(context.poolAddress, 20), fromHex(envelope.transportTag, 32), new Uint8Array([envelope.slot]));
}
export function serializeEnvelope(envelope: EnvelopeV1): Uint8Array {
  if (envelope.version !== 1 || !Number.isInteger(envelope.slot) || envelope.slot < 0 || envelope.slot > 7) throw new NullError('NULL_ENVELOPE_INVALID', 'Invalid envelope header.');
  const ephemeral = fromHex(envelope.ephemeralPubKey, 33);
  try { secp256k1.ProjectivePoint.fromHex(ephemeral).assertValidity(); } catch { throw new NullError('NULL_ENVELOPE_INVALID', 'Invalid ephemeral key.'); }
  return concatBytes(new Uint8Array([1, envelope.slot]), fromHex(envelope.transportTag, 32), ephemeral, fromHex(envelope.viewTag, 1), fromHex(envelope.ciphertext, ENVELOPE_CIPHERTEXT_BYTES));
}
export function envelopeRoot(envelopes: readonly EnvelopeV1[]): Hex {
  if (envelopes.length !== 8) throw new NullError('NULL_SLOT_COUNT_INVALID', 'Expected exactly eight envelopes.');
  const sorted = [...envelopes].sort((a, b) => a.slot - b.slot);
  if (sorted.some((envelope, slot) => envelope.slot !== slot || envelope.transportTag.toLowerCase() !== sorted[0]!.transportTag.toLowerCase())) throw new NullError('NULL_ENVELOPE_INVALID', 'Envelope slots are duplicated or context differs.');
  let nodes = sorted.map(envelope => keccak_256(serializeEnvelope(envelope)));
  while (nodes.length > 1) { const next: Uint8Array[] = []; for (let i = 0; i < nodes.length; i += 2) next.push(keccak_256(concatBytes(utf8('null.v1.envelope-merkle'), nodes[i]!, nodes[i + 1]!))); nodes = next; }
  return toHex(nodes[0]!);
}
export function distributionCommitment(allocationRoot: Hex, envelopesRoot: Hex, transportTag: Hex, expiry = 0n): Hex {
  if (expiry !== 0n) throw new NullError('NULL_VERSION_UNSUPPORTED', 'Expiry is not enabled for protocol v1.');
  return fieldHex(hashFields('null.v1.distribution', [1n, fieldFromHex(allocationRoot), ...split128(fromHex(envelopesRoot, 32)), expiry, ...split128(fromHex(transportTag, 32))]));
}
export function serializePlaintext(plaintext: EnvelopePlaintextV1): Uint8Array {
  envelopeAAD({ version: 1, slot: plaintext.slot, transportTag: plaintext.transportTag }, plaintext.context);
  allocationLeaf(plaintext);
  if (plaintext.allocationPath.length !== 3) throw new NullError('NULL_PATH_INVALID', 'Expected a three-level allocation path.');
  const data = concatBytes(
    utf8('NULL'), new Uint8Array([1, plaintext.flags, plaintext.slot]), bigintToBytes(plaintext.context.chainId, 8),
    fromHex(plaintext.context.poolAddress, 20), fromHex(plaintext.transportTag, 32), fromHex(plaintext.allocationRoot, 32),
    bigintToBytes(plaintext.amountAtomic, 8), bigintToBytes(assertField(plaintext.leafSalt)), fromHex(plaintext.stealthPublicKey, 65),
    ...plaintext.allocationPath.map(part => bigintToBytes(fieldFromHex(part))), bigintToBytes(plaintext.distributionLeafHint, 8),
  );
  const padded = new Uint8Array(ENVELOPE_PLAINTEXT_BYTES); padded.set(data); return padded;
}
export function parsePlaintext(bytes: Uint8Array): EnvelopePlaintextV1 {
  if (bytes.length !== ENVELOPE_PLAINTEXT_BYTES || !equalBytes(bytes.slice(0, 4), utf8('NULL')) || bytes[4] !== 1 || (bytes[5] !== 0 && bytes[5] !== 1) || bytes.slice(308).some(value => value !== 0)) throw new NullError('NULL_ENVELOPE_INVALID', 'Invalid encrypted allocation encoding.');
  const parsed: EnvelopePlaintextV1 = {
    flags: bytes[5] as 0 | 1, slot: bytes[6]!, context: { chainId: bytesToBigInt(bytes.slice(7, 15)), poolAddress: toHex(bytes.slice(15, 35)) },
    transportTag: toHex(bytes.slice(35, 67)), allocationRoot: toHex(bytes.slice(67, 99)), amountAtomic: bytesToBigInt(bytes.slice(99, 107)),
    leafSalt: assertField(bytesToBigInt(bytes.slice(107, 139))), stealthPublicKey: toHex(bytes.slice(139, 204)),
    allocationPath: [toHex(bytes.slice(204, 236)), toHex(bytes.slice(236, 268)), toHex(bytes.slice(268, 300))], distributionLeafHint: bytesToBigInt(bytes.slice(300, 308)),
  };
  allocationLeaf(parsed); return parsed;
}
export const webCryptoEncrypt: EncryptionProvider = async (key, nonce, plaintext, aad) => {
  const cryptoKey = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'AES-GCM' }, false, ['encrypt']);
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(nonce), additionalData: new Uint8Array(aad), tagLength: 128 }, cryptoKey, new Uint8Array(plaintext)));
};
export async function buildEnvelope(options: { plaintext: EnvelopePlaintextV1; ephemeralPubKey: Hex; viewTag: Hex; sharedSecret: Uint8Array; nonce: Uint8Array; encryptionProvider?: EncryptionProvider }): Promise<EnvelopeV1> {
  const { plaintext } = options;
  if (options.nonce.length !== 12) throw new NullError('NULL_ENVELOPE_INVALID', 'Invalid encryption nonce.');
  const header = { version: 1 as const, slot: plaintext.slot, transportTag: plaintext.transportTag };
  const aad = envelopeAAD(header, plaintext.context);
  const key = hkdf(sha256, options.sharedSecret, fromHex(plaintext.transportTag, 32), concatBytes(utf8('null.v1.envelope-key'), aad), 32);
  const encoded = serializePlaintext(plaintext);
  try {
    const encrypted = await (options.encryptionProvider ?? webCryptoEncrypt)(key, options.nonce, encoded, aad);
    const envelope = { ...header, ephemeralPubKey: options.ephemeralPubKey, viewTag: options.viewTag, ciphertext: toHex(concatBytes(options.nonce, encrypted)) };
    serializeEnvelope(envelope); return envelope;
  } finally { key.fill(0); encoded.fill(0); }
}
/** CLIENT ONLY. Authentication failures and view-tag collisions return null. */
export async function decryptEnvelope(envelope: EnvelopeV1, keys: ProfileKeys, context: ChainContext): Promise<(EnvelopePlaintextV1 & { stealthPrivateKey: Uint8Array }) | null> {
  serializeEnvelope(envelope);
  const recovered = recoverStealthDelivery(keys, envelope.ephemeralPubKey);
  if (recovered.viewTag.toLowerCase() !== envelope.viewTag.toLowerCase()) { recovered.sharedSecret.fill(0); recovered.stealthPrivateKey.fill(0); return null; }
  const aad = envelopeAAD(envelope, context);
  const key = hkdf(sha256, recovered.sharedSecret, fromHex(envelope.transportTag, 32), concatBytes(utf8('null.v1.envelope-key'), aad), 32);
  const ciphertext = fromHex(envelope.ciphertext, ENVELOPE_CIPHERTEXT_BYTES);
  let bytes: Uint8Array;
  try {
    const cryptoKey = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'AES-GCM' }, false, ['decrypt']);
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(ciphertext.slice(0, 12)), additionalData: new Uint8Array(aad), tagLength: 128 }, cryptoKey, new Uint8Array(ciphertext.slice(12))));
  } catch { recovered.stealthPrivateKey.fill(0); return null; }
  finally { key.fill(0); recovered.sharedSecret.fill(0); }
  try {
    const plain = parsePlaintext(bytes);
    if (plain.flags !== 1 || plain.context.chainId !== context.chainId || plain.context.poolAddress.toLowerCase() !== context.poolAddress.toLowerCase() || plain.transportTag.toLowerCase() !== envelope.transportTag.toLowerCase() || plain.slot !== envelope.slot || plain.stealthPublicKey.toLowerCase() !== recovered.stealthPublicKey.toLowerCase() || rootFromPath(allocationLeaf(plain), plain.slot, plain.allocationPath) !== plain.allocationRoot) throw new NullError('NULL_CONTEXT_MISMATCH', 'The allocation failed its context or commitment check.');
    return { ...plain, stealthPrivateKey: recovered.stealthPrivateKey };
  } catch (error) { recovered.stealthPrivateKey.fill(0); throw error; }
  finally { bytes.fill(0); }
}
export function claimNullifier(commitment: Hex, leaf: Hex): Hex { return fieldHex(hashFields('null.v1.claim-nullifier', [fieldFromHex(commitment), fieldFromHex(leaf)])); }
function nonzeroSecret(secret: bigint): bigint {
  if (assertField(secret) === 0n) throw new NullError('NULL_SECRET_INVALID', 'Note secrets must be nonzero.');
  return secret;
}
export function privateNoteBody(ownerNullifierKey: bigint, amountAtomic: bigint, noteSecret: bigint): Hex { return fieldHex(hashFields('null.v1.private-note', [hashFields('null.v1.note-owner', [nonzeroSecret(ownerNullifierKey)]), assertAmount(amountAtomic), nonzeroSecret(noteSecret)])); }
export function treasuryNoteBody(ownerNullifierKey: bigint, policy: Hex, amountAtomic: bigint, noteSecret: bigint): Hex { return fieldHex(hashFields('null.v1.treasury-note', [hashFields('null.v1.note-owner', [nonzeroSecret(ownerNullifierKey)]), nonzeroSecret(fieldFromHex(policy)), assertAmount(amountAtomic, true), nonzeroSecret(noteSecret)])); }
export function finalNoteCommitment(body: Hex, leafIndex: number): Hex {
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= 2 ** TREE_DEPTH) throw new NullError('NULL_PATH_INVALID', 'Invalid note position.');
  return fieldHex(hashFields('null.v1.final-note', [fieldFromHex(body), BigInt(leafIndex)]));
}
export function noteNullifier(commitment: Hex, ownerNullifierKey: bigint): Hex { return fieldHex(hashFields('null.v1.note-nullifier', [fieldFromHex(commitment), assertField(ownerNullifierKey)])); }
export function deriveNoteSecrets(stealthPrivateKey: Uint8Array, context: ChainContext, commitment: Hex, leaf: Hex): { ownerNullifierKey: bigint; noteSecret: bigint } {
  validateContext(context);
  const binding = concatBytes(bigintToBytes(context.chainId, 8), fromHex(context.poolAddress, 20), fromHex(commitment, 32), fromHex(leaf, 32));
  return { ownerNullifierKey: deriveField(stealthPrivateKey, concatBytes(utf8('null.v1.note-owner'), binding)), noteSecret: deriveField(stealthPrivateKey, concatBytes(utf8('null.v1.note-secret'), binding)) };
}
export function distributionIntentDigest(inputs: readonly Hex[]): Hex {
  if (inputs.length !== 15) throw new NullError('NULL_INTENT_INVALID', 'Distribution intent requires fifteen public fields.');
  return fieldHex(hashFields('null.v1.auth-intent', inputs.map(fieldFromHex)));
}
export function claimIntentDigest(inputs: readonly Hex[]): Hex {
  if (inputs.length !== 8) throw new NullError('NULL_INTENT_INVALID', 'Claim intent requires eight public fields.');
  return fieldHex(hashFields('null.v1.claim-intent', inputs.map(fieldFromHex)));
}
