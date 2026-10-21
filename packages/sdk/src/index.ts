import {
  type Hex, type ProfileKeys, type PrivacyProfile, NullError, assertAmount, bigintToBytes, bytesToBigInt,
  concatBytes, deriveField, deriveScalar, deriveStealthDelivery, fieldFromHex, fromHex,
  hkdf, hmac, parsePrivacyProfile, profileFromKeys, randomBytes, secp256k1, sha256, toHex, utf8,
} from '@null-protocol/crypto';
import {
  type AllocationV1, type ChainContext, type DistributionRecord, type EncryptionProvider, type EnvelopeV1,
  allocationLeaf, buildEnvelope, claimIntentDigest, claimNullifier, decryptEnvelope, deriveNoteSecrets,
  distributionCommitment, envelopeRoot, finalNoteCommitment, merklePath8, merkleRoot8, privateNoteBody,
  serializeEnvelope, validateContext,
} from '@null-protocol/protocol';

export * from '@null-protocol/crypto';
export * from '@null-protocol/protocol';
export * from './witnesses';
export * from './chain';

export interface PayrollRecipientV1 { employeeRef: string; amountAtomic: bigint; stealthMetaAddress: string }
export interface CompiledAllocation extends AllocationV1 { employeeRef?: string; slot: number; leaf: Hex; path: Hex[] }
export interface PublicDistributionBundle extends DistributionRecord {
  version: 1; chainId: string; poolAddress: Hex; expiry: '0'; envelopes: EnvelopeV1[];
}
export interface CompiledDistribution {
  commitment: Hex; allocationRoot: Hex; envelopeRoot: Hex; transportTag: Hex; totalAmount: bigint;
  realCount: number; envelopes: EnvelopeV1[]; allocations: CompiledAllocation[]; publicBundle: PublicDistributionBundle;
}
export interface CompileDistributionOptions {
  recipients: readonly PayrollRecipientV1[];
  context: ChainContext;
  /** Unique secret 32-byte entropy shared only between an authorized local/TEE compiler. Never publish or reuse. */
  batchEntropy?: Uint8Array;
  encryptionProvider?: EncryptionProvider;
}

function deriveBytes(entropy: Uint8Array, label: string, length: number): Uint8Array {
  return hkdf(sha256, entropy, utf8('null.v1.compiler'), utf8(label), length);
}
function canonicalRecipient(recipient: PayrollRecipientV1): PayrollRecipientV1 {
  const employeeRef = recipient.employeeRef.normalize('NFKC').trim();
  if (!employeeRef || utf8(employeeRef).length > 200 || /[\u0000-\u001f\u007f]/u.test(employeeRef)) throw new NullError('NULL_RECIPIENT_INVALID', 'Each recipient needs a valid private reference.');
  return { employeeRef, amountAtomic: assertAmount(recipient.amountAtomic), stealthMetaAddress: parsePrivacyProfile(recipient.stealthMetaAddress).stealthMetaAddress };
}
function canonicalRecipientBytes(recipient: PayrollRecipientV1): Uint8Array {
  const employee = utf8(recipient.employeeRef); const profile = utf8(recipient.stealthMetaAddress);
  return concatBytes(bigintToBytes(BigInt(employee.length), 2), employee, bigintToBytes(recipient.amountAtomic, 8), bigintToBytes(BigInt(profile.length), 2), profile);
}

/** Confidential local/TEE compiler. The result is a prepared draft, never a proof or a submitted distribution. */
export async function compileDistribution(options: CompileDistributionOptions): Promise<CompiledDistribution> {
  validateContext(options.context);
  if (options.recipients.length < 1 || options.recipients.length > 8) throw new NullError('NULL_SLOT_COUNT_INVALID', 'Choose between one and eight recipients.');
  const recipients = options.recipients.map(canonicalRecipient);
  if (new Set(recipients.map(recipient => recipient.employeeRef.toLocaleLowerCase('en-US'))).size !== recipients.length) throw new NullError('NULL_RECIPIENT_INVALID', 'Private recipient references must be unique.');
  const entropy = options.batchEntropy ? new Uint8Array(options.batchEntropy) : randomBytes(32);
  if (entropy.length !== 32 || entropy.every(value => value === 0)) throw new NullError('NULL_RANDOMNESS_FAILED', 'Batch entropy must contain 32 fresh secret bytes.');
  try {
    const orderingKey = deriveBytes(entropy, 'ordering', 32);
    const ordered = recipients.map(recipient => ({ recipient, rank: toHex(hmac(sha256, orderingKey, canonicalRecipientBytes(recipient))) })).sort((a, b) => a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);
    orderingKey.fill(0);
    const slots: (PayrollRecipientV1 | null)[] = ordered.map(item => item.recipient);
    while (slots.length < 8) slots.push(null);
    let shuffleCounter = 0;
    for (let i = 7; i > 0; i--) {
      const range = i + 1; const limit = Math.floor(2 ** 32 / range) * range; let candidate: number;
      do { candidate = Number(bytesToBigInt(deriveBytes(entropy, `shuffle/${shuffleCounter++}`, 4))); } while (candidate >= limit);
      const j = candidate % range; [slots[i], slots[j]] = [slots[j]!, slots[i]!];
    }
    const transportTag = toHex(deriveBytes(entropy, 'transport-tag', 32));
    const prepared = slots.map((recipient, slot) => {
      let profile: PrivacyProfile;
      if (recipient) profile = parsePrivacyProfile(recipient.stealthMetaAddress);
      else {
        const spendPrivateKey = deriveScalar(entropy, utf8(`dummy/${slot}/spend`));
        const viewPrivateKey = deriveScalar(entropy, utf8(`dummy/${slot}/view`));
        try { profile = profileFromKeys({ spendPrivateKey, viewPrivateKey }); } finally { spendPrivateKey.fill(0); viewPrivateKey.fill(0); }
      }
      const ephemeral = deriveScalar(entropy, utf8(`slot/${slot}/ephemeral`));
      const delivery = deriveStealthDelivery(profile, ephemeral); ephemeral.fill(0);
      const allocation: AllocationV1 = { stealthPublicKey: delivery.stealthPublicKey, amountAtomic: recipient?.amountAtomic ?? 0n, leafSalt: deriveField(entropy, utf8(`slot/${slot}/leaf-salt`)), flags: recipient ? 1 : 0 };
      return { allocation, recipient, delivery, slot };
    });
    const leaves = prepared.map(item => allocationLeaf(item.allocation));
    const allocationRoot = merkleRoot8(leaves);
    const envelopes: EnvelopeV1[] = [];
    const allocations: CompiledAllocation[] = [];
    try {
      for (const item of prepared) {
        const path = merklePath8(leaves, item.slot).siblings;
        envelopes.push(await buildEnvelope({
          plaintext: { ...item.allocation, slot: item.slot, context: options.context, transportTag, allocationRoot, allocationPath: path, distributionLeafHint: (1n << 64n) - 1n },
          ephemeralPubKey: item.delivery.ephemeralPubKey, viewTag: item.delivery.viewTag, sharedSecret: item.delivery.sharedSecret,
          nonce: deriveBytes(entropy, `slot/${item.slot}/nonce`, 12), encryptionProvider: options.encryptionProvider,
        }));
        allocations.push({ ...item.allocation, slot: item.slot, leaf: leaves[item.slot]!, path, ...(item.recipient ? { employeeRef: item.recipient.employeeRef } : {}) });
      }
    } finally { for (const item of prepared) item.delivery.sharedSecret.fill(0); }
    const envelopesRoot = envelopeRoot(envelopes);
    const commitment = distributionCommitment(allocationRoot, envelopesRoot, transportTag);
    const totalAmount = recipients.reduce((sum, recipient) => sum + recipient.amountAtomic, 0n);
    const publicBundle: PublicDistributionBundle = { version: 1, chainId: options.context.chainId.toString(), poolAddress: options.context.poolAddress.toLowerCase() as Hex, commitment, envelopeRoot: envelopesRoot, transportTag, expiry: '0', envelopes };
    return { commitment, allocationRoot, envelopeRoot: envelopesRoot, transportTag, totalAmount, realCount: recipients.length, envelopes, allocations, publicBundle };
  } finally { entropy.fill(0); }
}

export interface DiscoveredAllocation {
  id: Hex; amountAtomic: bigint; distributionCommitment: Hex; allocationLeaf: Hex; allocationRoot: Hex; allocationPath: Hex[];
  slot: number; stealthPublicKey: Hex; stealthPrivateKey: Uint8Array; leafSalt: bigint; context: ChainContext;
  transportTag: Hex; envelopeRoot: Hex; confirmed: boolean; source: 'local' | 'chain'; distributionLeafIndex?: number;
}
export interface ScanOptions {
  envelopes: readonly EnvelopeV1[]; distributions: readonly DistributionRecord[]; keys: ProfileKeys;
  context: ChainContext; source?: 'local' | 'chain'; signal?: AbortSignal;
}
/** CLIENT ONLY. Fetch broad public history first; secrets are never sent to Graph or RPC. */
export async function scanEnvelopes(options: ScanOptions): Promise<DiscoveredAllocation[]> {
  validateContext(options.context);
  const discoveries: DiscoveredAllocation[] = [];
  const records = new Map<string, DistributionRecord>();
  for (const record of options.distributions) {
    const tag = record.transportTag.toLowerCase();
    if (records.has(tag)) throw new NullError('NULL_CONTEXT_MISMATCH', 'Duplicate distribution transport context.');
    fieldFromHex(record.commitment); fromHex(record.envelopeRoot, 32); fromHex(record.transportTag, 32);
    if (record.expiry !== undefined && record.expiry !== '0') throw new NullError('NULL_VERSION_UNSUPPORTED', 'This distribution version does not support expiry.');
    records.set(tag, record);
  }
  const groups = new Map<string, EnvelopeV1[]>();
  for (const envelope of options.envelopes) { const tag = envelope.transportTag.toLowerCase(); const group = groups.get(tag) ?? []; group.push(envelope); groups.set(tag, group); }
  try {
    for (const [tag, envelopes] of groups) {
      options.signal?.throwIfAborted();
      const record = records.get(tag);
      if (!record || envelopes.length !== 8) continue; // A partial indexed batch is retried after more history arrives.
      if (envelopeRoot(envelopes).toLowerCase() !== record.envelopeRoot.toLowerCase()) throw new NullError('NULL_CONTEXT_MISMATCH', 'Encrypted delivery data does not match its distribution commitment.');
      for (const envelope of envelopes) {
        options.signal?.throwIfAborted();
        const plain = await decryptEnvelope(envelope, options.keys, options.context);
        if (!plain) continue;
        const commitment = distributionCommitment(plain.allocationRoot, record.envelopeRoot, record.transportTag);
        if (commitment.toLowerCase() !== record.commitment.toLowerCase()) { plain.stealthPrivateKey.fill(0); throw new NullError('NULL_CONTEXT_MISMATCH', 'The allocation does not belong to this distribution.'); }
        const leaf = allocationLeaf(plain);
        discoveries.push({ id: claimNullifier(commitment, leaf), amountAtomic: plain.amountAtomic, distributionCommitment: commitment, allocationLeaf: leaf,
          allocationRoot: plain.allocationRoot, allocationPath: [...plain.allocationPath], slot: plain.slot, stealthPublicKey: plain.stealthPublicKey,
          stealthPrivateKey: plain.stealthPrivateKey, leafSalt: plain.leafSalt, context: plain.context, transportTag: plain.transportTag,
          envelopeRoot: record.envelopeRoot, confirmed: options.source === 'local' ? false : record.confirmed === true, source: options.source ?? 'chain',
          ...(record.leafIndex !== undefined ? { distributionLeafIndex: record.leafIndex } : {}),
        });
      }
    }
    return discoveries;
  } catch (error) { for (const discovered of discoveries) discovered.stealthPrivateKey.fill(0); throw error; }
}
export const scanEnvelope = decryptEnvelope;

export interface PrivateNoteDraft {
  amountAtomic: bigint; ownerNullifierKey: bigint; noteSecret: bigint; bodyCommitment: Hex; claimNullifier: Hex;
}
/** CLIENT ONLY. This constructs note secrets; a note exists onchain only after a verified claim transaction. */
export function buildPrivateNote(allocation: DiscoveredAllocation): PrivateNoteDraft {
  const secrets = deriveNoteSecrets(allocation.stealthPrivateKey, allocation.context, allocation.distributionCommitment, allocation.allocationLeaf);
  return { ...secrets, amountAtomic: allocation.amountAtomic, bodyCommitment: privateNoteBody(secrets.ownerNullifierKey, allocation.amountAtomic, secrets.noteSecret), claimNullifier: claimNullifier(allocation.distributionCommitment, allocation.allocationLeaf) };
}
export function finalizePrivateNote(note: PrivateNoteDraft, leafIndex: number): PrivateNoteDraft & { leafIndex: number; commitment: Hex } {
  return { ...note, leafIndex, commitment: finalNoteCommitment(note.bodyCommitment, leafIndex) };
}

/** Public-only export. It intentionally excludes recipient references, amounts, allocation paths and salts. */
export function exportPublicBundle(compiled: CompiledDistribution): string { return JSON.stringify(compiled.publicBundle, null, 2); }
export function parsePublicBundle(text: string): PublicDistributionBundle {
  if (text.length > 100_000) throw new NullError('NULL_BUNDLE_INVALID', 'This distribution file is too large.');
  let data: unknown; try { data = JSON.parse(text); } catch { throw new NullError('NULL_BUNDLE_INVALID', 'Enter a valid distribution JSON file.'); }
  if (!data || typeof data !== 'object') throw new NullError('NULL_BUNDLE_INVALID', 'Invalid distribution file.');
  const raw = data as Record<string, unknown>;
  if (raw.version !== 1 || raw.expiry !== '0' || typeof raw.chainId !== 'string' || !/^[1-9][0-9]*$/.test(raw.chainId) || typeof raw.poolAddress !== 'string' || typeof raw.commitment !== 'string' || typeof raw.transportTag !== 'string' || typeof raw.envelopeRoot !== 'string' || !Array.isArray(raw.envelopes)) throw new NullError('NULL_BUNDLE_INVALID', 'Unsupported distribution file format.');
  validateContext({ chainId: BigInt(raw.chainId), poolAddress: raw.poolAddress as Hex }); fieldFromHex(raw.commitment as Hex); fromHex(raw.transportTag, 32);
  const envelopes: EnvelopeV1[] = raw.envelopes.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new NullError('NULL_BUNDLE_INVALID', 'Invalid encrypted envelope.');
    const envelope = value as Record<string, unknown>;
    if (envelope.version !== 1 || typeof envelope.slot !== 'number' || typeof envelope.transportTag !== 'string' || typeof envelope.ephemeralPubKey !== 'string' || typeof envelope.viewTag !== 'string' || typeof envelope.ciphertext !== 'string') throw new NullError('NULL_BUNDLE_INVALID', 'Invalid encrypted envelope.');
    const parsed: EnvelopeV1 = { version: 1, slot: envelope.slot, transportTag: envelope.transportTag as Hex, ephemeralPubKey: envelope.ephemeralPubKey as Hex, viewTag: envelope.viewTag as Hex, ciphertext: envelope.ciphertext as Hex }; serializeEnvelope(parsed); return parsed;
  });
  if (envelopes.some(envelope => envelope.transportTag.toLowerCase() !== (raw.transportTag as string).toLowerCase()) || envelopeRoot(envelopes).toLowerCase() !== raw.envelopeRoot.toLowerCase()) throw new NullError('NULL_CONTEXT_MISMATCH', 'The distribution delivery checksum does not match.');
  return { version: 1, expiry: '0', chainId: raw.chainId, poolAddress: raw.poolAddress as Hex, commitment: raw.commitment as Hex, transportTag: raw.transportTag as Hex, envelopeRoot: raw.envelopeRoot as Hex, envelopes };
}

export function assertCompilationMatches(local: CompiledDistribution, remote: Pick<CompiledDistribution, 'commitment' | 'envelopeRoot' | 'transportTag'>): void {
  if (local.commitment.toLowerCase() !== remote.commitment.toLowerCase() || local.envelopeRoot.toLowerCase() !== remote.envelopeRoot.toLowerCase() || local.transportTag.toLowerCase() !== remote.transportTag.toLowerCase()) throw new NullError('NULL_CRE_COMPILE_MISMATCH', 'Confidential and local compilation disagree. Distribution is blocked.');
}

/** Raw, low-S, compact secp256k1 signature. Never use personal_sign for this digest. */
export function signClaimIntent(publicInputs: readonly Hex[], stealthPrivateKey: Uint8Array): Hex {
  const signature = secp256k1.sign(fromHex(claimIntentDigest(publicInputs)), stealthPrivateKey, { lowS: true, prehash: false });
  return toHex(signature.toCompactRawBytes());
}
