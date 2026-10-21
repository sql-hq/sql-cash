import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { keccak_256 } from '@noble/hashes/sha3';
import { hkdf } from '@noble/hashes/hkdf';
import { hmac } from '@noble/hashes/hmac';
import { poseidon2 } from 'poseidon-lite/poseidon2';
import { poseidon3 } from 'poseidon-lite/poseidon3';
import { poseidon4 } from 'poseidon-lite/poseidon4';
import { poseidon5 } from 'poseidon-lite/poseidon5';
import { poseidon8 } from 'poseidon-lite/poseidon8';
import { poseidon9 } from 'poseidon-lite/poseidon9';
import { poseidon11 } from 'poseidon-lite/poseidon11';
import { poseidon16 } from 'poseidon-lite/poseidon16';

export { secp256k1, sha256, keccak_256, hkdf, hmac };
export type Hex = `0x${string}`;
export const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const SECP256K1_ORDER = 115792089237316195423570985008687907852837564279074904382605163141518161494337n;
export const UINT64_MAX = (1n << 64n) - 1n;
export const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

export class NullError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'NullError'; this.code = code; }
}

export function toHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
export function fromHex(value: string, expectedLength?: number): Uint8Array {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new NullError('NULL_ENCODING_INVALID', 'Invalid hexadecimal encoding.');
  const bytes = Uint8Array.from(value.slice(2).match(/.{2}/g) ?? [], byte => Number.parseInt(byte, 16));
  if (expectedLength !== undefined && bytes.length !== expectedLength) throw new NullError('NULL_ENCODING_INVALID', 'Unexpected encoded byte length.');
  return bytes;
}
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
export function bytesToBigInt(bytes: Uint8Array): bigint { return bytes.length ? BigInt(toHex(bytes)) : 0n; }
export function bigintToBytes(value: bigint, length = 32): Uint8Array {
  if (value < 0n || value >= 1n << BigInt(length * 8)) throw new NullError('NULL_RANGE_INVALID', 'Integer is outside its canonical range.');
  return fromHex(`0x${value.toString(16).padStart(length * 2, '0')}`, length);
}
export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i]! ^ right[i]!;
  return difference === 0;
}
export function randomBytes(length: number): Uint8Array {
  if (!globalThis.crypto?.getRandomValues) throw new NullError('NULL_CRYPTO_UNAVAILABLE', 'A secure browser context is required.');
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}
export function assertField(value: bigint): bigint {
  if (value < 0n || value >= FIELD_MODULUS) throw new NullError('NULL_FIELD_INVALID', 'A non-canonical field element was rejected.');
  return value;
}
export function fieldHex(value: bigint): Hex { return toHex(bigintToBytes(assertField(value))); }
export function fieldFromHex(value: Hex): bigint { return assertField(bytesToBigInt(fromHex(value, 32))); }
export function split128(value: Uint8Array): [bigint, bigint] {
  if (value.length !== 32) throw new NullError('NULL_ENCODING_INVALID', 'Expected a 256-bit value.');
  return [bytesToBigInt(value.slice(0, 16)), bytesToBigInt(value.slice(16))];
}

export const DOMAIN_LABELS = [
  'null.v1.pk', 'null.v1.merkle', 'null.v1.treasury-note', 'null.v1.private-note',
  'null.v1.final-note', 'null.v1.note-nullifier', 'null.v1.allocation', 'null.v1.distribution',
  'null.v1.claim-nullifier', 'null.v1.auth-policy', 'null.v1.auth-intent', 'null.v1.note-owner', 'null.v1.note-secret', 'null.v1.phantom-nullifier', 'null.v1.claim-intent', 'null.v1.withdraw-intent',
] as const;
export type DomainLabel = typeof DOMAIN_LABELS[number];
const domainFields = new Map<DomainLabel, bigint>(DOMAIN_LABELS.map(label => [label, bytesToBigInt(sha256(utf8(label)).slice(0, 31))]));
export function domainField(label: DomainLabel): bigint {
  const value = domainFields.get(label);
  if (value === undefined) throw new NullError('NULL_DOMAIN_INVALID', 'Unknown protocol hash domain.');
  return value;
}
const poseidonByArity: Record<number, (inputs: bigint[]) => bigint> = { 2: poseidon2, 3: poseidon3, 4: poseidon4, 5: poseidon5, 8: poseidon8, 9: poseidon9, 11: poseidon11, 16: poseidon16 };
export function hashFields(domain: DomainLabel, values: bigint[]): bigint {
  const inputs = [domainField(domain), ...values.map(assertField)];
  const hash = poseidonByArity[inputs.length];
  if (!hash) throw new NullError('NULL_HASH_ARITY_INVALID', 'Unsupported protocol hash arity.');
  return hash(inputs);
}

/** Unbiased rejection sampling. This is a KDF, not modular reduction of arbitrary input. */
export function deriveField(secret: Uint8Array, info: Uint8Array): bigint {
  for (let counter = 0; counter < 65536; counter++) {
    const candidate = hkdf(sha256, secret, utf8('null.v1.hash-to-field'), concatBytes(info, bigintToBytes(BigInt(counter), 4)), 32);
    const value = bytesToBigInt(candidate); candidate.fill(0);
    if (value > 0n && value < FIELD_MODULUS) return value;
  }
  throw new NullError('NULL_RANDOMNESS_FAILED', 'Could not derive a canonical secret.');
}
export function deriveScalar(secret: Uint8Array, info: Uint8Array): Uint8Array {
  for (let counter = 0; counter < 65536; counter++) {
    const candidate = hkdf(sha256, secret, utf8('null.v1.scalar'), concatBytes(info, bigintToBytes(BigInt(counter), 4)), 32);
    const value = bytesToBigInt(candidate);
    if (value > 0n && value < SECP256K1_ORDER) return candidate;
    candidate.fill(0);
  }
  throw new NullError('NULL_RANDOMNESS_FAILED', 'Could not derive a valid private key.');
}
export function randomPrivateKey(): Uint8Array {
  const entropy = randomBytes(32);
  try { return deriveScalar(entropy, utf8('null.v1.profile-key')); } finally { entropy.fill(0); }
}

export interface PrivacyProfile {
  version: 1;
  schemeId: 1;
  spendPublicKey: Hex;
  viewPublicKey: Hex;
  stealthMetaAddress: string;
}
export interface ProfileKeys { spendPrivateKey: Uint8Array; viewPrivateKey: Uint8Array }
export function validateProfileKeys(keys: ProfileKeys): void {
  if (!secp256k1.utils.isValidPrivateKey(keys.spendPrivateKey) || !secp256k1.utils.isValidPrivateKey(keys.viewPrivateKey)) throw new NullError('NULL_PROFILE_INVALID', 'The privacy keys are invalid.');
  if (equalBytes(keys.spendPrivateKey, keys.viewPrivateKey)) throw new NullError('NULL_PROFILE_INVALID', 'Viewing and spending keys must be separate.');
}
export function profileFromKeys(keys: ProfileKeys): PrivacyProfile {
  validateProfileKeys(keys);
  const spendPublicKey = toHex(secp256k1.getPublicKey(keys.spendPrivateKey, true));
  const viewPublicKey = toHex(secp256k1.getPublicKey(keys.viewPrivateKey, true));
  return { version: 1, schemeId: 1, spendPublicKey, viewPublicKey, stealthMetaAddress: `st:eth:${spendPublicKey}${viewPublicKey.slice(2)}` };
}
/** CLIENT ONLY: never send the returned private keys to a service. */
export function createPrivacyProfile(): { profile: PrivacyProfile; keys: ProfileKeys } {
  const keys = { spendPrivateKey: randomPrivateKey(), viewPrivateKey: randomPrivateKey() };
  return { profile: profileFromKeys(keys), keys };
}
export function parsePrivacyProfile(value: string): PrivacyProfile {
  const normalized = value.trim();
  if (!/^st:eth:0x[0-9a-fA-F]{132}$/.test(normalized)) throw new NullError('NULL_PROFILE_INVALID', 'Enter a complete NULL privacy profile.');
  const bytes = fromHex(normalized.slice(7));
  const spendPublicKey = toHex(bytes.slice(0, 33));
  const viewPublicKey = toHex(bytes.slice(33));
  try {
    secp256k1.ProjectivePoint.fromHex(fromHex(spendPublicKey)).assertValidity();
    secp256k1.ProjectivePoint.fromHex(fromHex(viewPublicKey)).assertValidity();
  } catch { throw new NullError('NULL_PROFILE_INVALID', 'The privacy profile contains an invalid public key.'); }
  if (spendPublicKey === viewPublicKey) throw new NullError('NULL_PROFILE_INVALID', 'Viewing and spending public keys must be separate.');
  return { version: 1, schemeId: 1, spendPublicKey, viewPublicKey, stealthMetaAddress: `st:eth:${spendPublicKey}${viewPublicKey.slice(2)}` };
}
export interface StealthDelivery { ephemeralPubKey: Hex; stealthPublicKey: Hex; viewTag: Hex; sharedSecret: Uint8Array }
/** ERC-5564 scheme 1: keccak256 of uncompressed ECDH point without the 04 prefix. */
export function deriveStealthDelivery(profile: PrivacyProfile, ephemeralPrivateKey: Uint8Array): StealthDelivery {
  const sharedSecret = secp256k1.getSharedSecret(ephemeralPrivateKey, fromHex(profile.viewPublicKey), false).slice(1);
  const hashed = keccak_256(sharedSecret);
  const tweak = bytesToBigInt(hashed) % SECP256K1_ORDER;
  if (tweak === 0n) throw new NullError('NULL_RANDOMNESS_FAILED', 'Regenerate the distribution entropy.');
  const publicKey = secp256k1.ProjectivePoint.fromHex(fromHex(profile.spendPublicKey)).add(secp256k1.ProjectivePoint.BASE.multiply(tweak));
  if (publicKey.equals(secp256k1.ProjectivePoint.ZERO)) throw new NullError('NULL_RANDOMNESS_FAILED', 'Regenerate the distribution entropy.');
  return { ephemeralPubKey: toHex(secp256k1.getPublicKey(ephemeralPrivateKey, true)), stealthPublicKey: toHex(publicKey.toRawBytes(false)), viewTag: toHex(hashed.slice(0, 1)), sharedSecret };
}
/** CLIENT ONLY. ECDH necessarily precedes the view-tag filter. */
export function recoverStealthDelivery(keys: ProfileKeys, ephemeralPubKey: Hex): StealthDelivery & { stealthPrivateKey: Uint8Array } {
  validateProfileKeys(keys);
  const sharedSecret = secp256k1.getSharedSecret(keys.viewPrivateKey, fromHex(ephemeralPubKey, 33), false).slice(1);
  const hashed = keccak_256(sharedSecret);
  const scalar = (bytesToBigInt(keys.spendPrivateKey) + bytesToBigInt(hashed)) % SECP256K1_ORDER;
  if (scalar === 0n) throw new NullError('NULL_PROFILE_INVALID', 'Invalid one-time key.');
  const stealthPrivateKey = bigintToBytes(scalar);
  return { sharedSecret, stealthPrivateKey, ephemeralPubKey, stealthPublicKey: toHex(secp256k1.getPublicKey(stealthPrivateKey, false)), viewTag: toHex(hashed.slice(0, 1)) };
}

export function assertAmount(value: bigint, allowZero = false): bigint {
  if (typeof value !== 'bigint' || value < (allowZero ? 0n : 1n) || value > UINT64_MAX) throw new NullError('NULL_AMOUNT_INVALID', 'Amount must be positive and fit within 64 atomic bits.');
  return value;
}
export function parseAmount(value: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(value.trim())) throw new NullError('NULL_AMOUNT_INVALID', 'Use a positive amount with at most six decimal places.');
  const [whole = '0', fraction = ''] = value.trim().split('.');
  return assertAmount(BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0')));
}
export function formatAmount(value: bigint, minimumDecimals = 2): string {
  if (value < 0n || minimumDecimals < 0 || minimumDecimals > 6) throw new NullError('NULL_AMOUNT_INVALID', 'Invalid amount format.');
  const whole = (value / 1_000_000n).toString();
  let fraction = (value % 1_000_000n).toString().padStart(6, '0');
  while (fraction.length > minimumDecimals && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  return whole + (fraction ? `.${fraction}` : '');
}
