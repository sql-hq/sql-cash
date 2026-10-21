import { recoverAddress, recoverPublicKey, toHex, type Address, type Hex } from 'viem';
import { publicKeyToAddress } from 'viem/accounts';
import { distributionIntentDigest, withdrawalIntentDigest, secp256k1, fromHex, sha256, utf8 } from '@null-protocol/sdk';

export interface DistributionIntentContext {
  chainId: bigint;
  poolAddress: Address;
  commitment: Hex;
  envelopeRoot: Hex;
}
export interface WithdrawalIntentContext { kind: 'withdrawal'; chainId: bigint; poolAddress: Address; recipient: Address; amountAtomic: bigint }
export type CompiledIntentContext = DistributionIntentContext | WithdrawalIntentContext;
export function validateWithdrawalIntent(inputs: readonly Hex[], expected: WithdrawalIntentContext, nowSeconds = BigInt(Math.floor(Date.now()/1000))) {
  if (inputs.length !== 10 || inputs.some(input => !/^0x[0-9a-fA-F]{64}$/.test(input) || BigInt(input) >= FIELD)) throw new Error('NULL_CONTEXT_MISMATCH');
  if (!/^0x[0-9a-fA-F]{40}$/.test(expected.recipient) || BigInt(expected.recipient) === 0n || BigInt(expected.recipient) === BigInt(expected.poolAddress) || expected.amountAtomic <= 0n || expected.amountAtomic >= 1n << 64n) throw new Error('NULL_CONTEXT_MISMATCH');
  if (BigInt(inputs[0]) !== 1n || BigInt(inputs[1]) !== expected.chainId || BigInt(inputs[2]) !== BigInt(expected.poolAddress) || BigInt(inputs[6]) !== BigInt(expected.recipient) || BigInt(inputs[7]) !== expected.amountAtomic || !BigInt(inputs[5]) || !BigInt(inputs[8])) throw new Error('NULL_CONTEXT_MISMATCH');
  if (BigInt(inputs[9]) <= nowSeconds || BigInt(inputs[9]) > nowSeconds + 86_400n) throw new Error('NULL_INTENT_EXPIRED');
}
export function validatePaymentIntent(inputs: readonly Hex[], expected: CompiledIntentContext) {
  if ('kind' in expected && expected.kind === 'withdrawal') validateWithdrawalIntent(inputs, expected);
  else validateDistributionIntent(inputs, expected as DistributionIntentContext);
}
export function paymentIntentDigest(inputs: readonly Hex[], expected: CompiledIntentContext): Hex {
  validatePaymentIntent(inputs,expected);
  return 'kind' in expected && expected.kind === 'withdrawal' ? withdrawalIntentDigest(inputs) : distributionIntentDigest(inputs);
}
export interface AuthorizationRequest {
  version: 1;
  method: 'POST';
  url: string;
  headers: { 'privy-app-id': string; 'privy-request-expiry': string };
  body: { method: 'secp256k1_sign'; params: { hash: Hex } };
}
export function organizationIdentityRequest(options: { appId: string; walletId: string; chainId: bigint; poolAddress: Address; requestExpiryMs?: number }): AuthorizationRequest {
  if (![options.appId, options.walletId].every(id => /^[a-zA-Z0-9_-]+$/.test(id)) || options.chainId !== 11155111n || !/^0x[0-9a-fA-F]{40}$/.test(options.poolAddress)) throw new Error('NULL_PRIVY_CONFIG_REQUIRED');
  const expiry = options.requestExpiryMs ?? Date.now() + 120_000;
  if (!Number.isSafeInteger(expiry) || expiry <= Date.now() || expiry > Date.now() + 300_000) throw new Error('NULL_INTENT_EXPIRED');
  const hash = toHex(sha256(utf8(JSON.stringify(['NULL organization identity only v1', options.appId, options.walletId, options.chainId.toString(), options.poolAddress.toLowerCase()]))));
  return { version: 1, method: 'POST', url: `https://api.privy.io/v1/wallets/${options.walletId}/rpc`, headers: { 'privy-app-id': options.appId, 'privy-request-expiry': String(expiry) }, body: { method: 'secp256k1_sign', params: { hash } } };
}

/** One owner-approved identity challenge obtains the public key without exporting wallet secrets. */
export async function identifyOrganizationSigner(options: { endpoint: string; appId: string; chainId: bigint; poolAddress: Address; walletAddress: Address; getAccessToken: () => Promise<string | null>; generateAuthorizationSignature: (request: AuthorizationRequest) => Promise<string | { signature: string }> }): Promise<Hex> {
  const endpoint = new URL(options.endpoint);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname)))) throw new Error('NULL_PRIVY_CONFIG_REQUIRED');
  const post = async (route: string, body: unknown) => {
    const token = await options.getAccessToken(); if (!token) throw new Error('NULL_SESSION_REQUIRED');
    const response = await fetch(`${endpoint.href.replace(/\/$/, '')}/api/organization/${route}`, { method: 'POST', credentials: 'omit', redirect: 'error', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof data.code === 'string' && /^NULL_[A-Z_]+$/.test(data.code) ? data.code : 'NULL_ORGANIZATION_UNAVAILABLE');
    return data;
  };
  const prepared = await post('prepare-identity', {});
  const request = prepared.authorizationRequest as AuthorizationRequest;
  const walletId = request?.url?.match(/^https:\/\/api\.privy\.io\/v1\/wallets\/([a-zA-Z0-9_-]+)\/rpc$/)?.[1];
  if (!walletId || typeof prepared.walletAddress !== 'string' || prepared.walletAddress.toLowerCase() !== options.walletAddress.toLowerCase() || prepared.minimumApprovals !== 1 || typeof prepared.ticket !== 'string' || !/^[a-f0-9-]{36}$/.test(prepared.ticket)) throw new Error('NULL_CONTEXT_MISMATCH');
  const canonical = organizationIdentityRequest({ ...options, walletId, requestExpiryMs: Number(request.headers?.['privy-request-expiry']) });
  // Exact shape checks prevent approval of extra or substituted RPC parameters.
  const normalize = (value: unknown): string => value && typeof value === 'object' ? (Array.isArray(value) ? `[${value.map(normalize).join(',')}]` : `{${Object.keys(value).sort().map(key => `${key}:${normalize((value as Record<string, unknown>)[key])}`).join(',')}}`) : JSON.stringify(value);
  if (normalize(request) !== normalize(canonical)) throw new Error('NULL_CONTEXT_MISMATCH');
  const generated = await options.generateAuthorizationSignature(canonical);
  const result = await post('identify', { ticket: prepared.ticket, signatures: [typeof generated === 'string' ? generated : generated.signature] });
  if (result.digest !== canonical.body.params.hash || typeof result.signer !== 'string' || result.signer.toLowerCase() !== options.walletAddress.toLowerCase()) throw new Error('NULL_CONTEXT_MISMATCH');
  // The adapter already recovers the key from the raw signature; independently bind it here.
  if (typeof result.publicKey !== 'string' || !/^0x04[0-9a-fA-F]{128}$/.test(result.publicKey) || publicKeyToAddress(result.publicKey as Hex).toLowerCase() !== options.walletAddress.toLowerCase()) throw new Error('NULL_CONTEXT_MISMATCH');
  return result.publicKey as Hex;
}
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
export function validateDistributionIntent(publicInputs: readonly Hex[], expected: DistributionIntentContext, nowSeconds = BigInt(Math.floor(Date.now() / 1000))) {
  if (publicInputs.length !== 15 || publicInputs.some(input => !/^0x[0-9a-fA-F]{64}$/.test(input) || BigInt(input) >= FIELD)) throw new Error('NULL_CONTEXT_MISMATCH');
  if (BigInt(publicInputs[0]) !== 1n || BigInt(publicInputs[1]) !== expected.chainId || BigInt(publicInputs[2]) !== BigInt(expected.poolAddress) || BigInt(publicInputs[7]) !== BigInt(expected.commitment)) throw new Error('NULL_CONTEXT_MISMATCH');
  const envelope = (BigInt(publicInputs[8]) << 128n) | BigInt(publicInputs[9]);
  if (BigInt(publicInputs[8]) >= 1n << 128n || BigInt(publicInputs[9]) >= 1n << 128n || envelope !== BigInt(expected.envelopeRoot)) throw new Error('NULL_CRE_COMPILE_MISMATCH');
  if (BigInt(publicInputs[14]) <= nowSeconds || BigInt(publicInputs[14]) > nowSeconds + 86_400n) throw new Error('NULL_INTENT_EXPIRED');
}
export async function createPrivyAuthorizationRequest(options: {
  appId: string; walletId: string; publicInputs: readonly Hex[]; expected: CompiledIntentContext; requestExpiryMs?: number;
}): Promise<AuthorizationRequest> {
  validatePaymentIntent(options.publicInputs, options.expected);
  if (!/^[a-zA-Z0-9_-]+$/.test(options.walletId) || !options.appId) throw new Error('NULL_PRIVY_AUTH_FAILED');
  const now = Date.now();
  const expiry = options.requestExpiryMs ?? now + 120_000;
  if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now + 300_000 || BigInt(expiry) > BigInt(options.publicInputs.at(-1)!) * 1000n) throw new Error('NULL_INTENT_EXPIRED');
  return {
    version: 1, method: 'POST', url: `https://api.privy.io/v1/wallets/${options.walletId}/rpc`,
    headers: { 'privy-app-id': options.appId, 'privy-request-expiry': String(expiry) },
    body: { method: 'secp256k1_sign', params: { hash: await paymentIntentDigest(options.publicInputs, options.expected) } },
  };
}
/** This result is a private circuit witness. Never attach it to relay payloads or logs. */
export async function verifyPrivyIntentSignature(digest: Hex, signature: Hex, expectedSigner: Address) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(digest) || !/^0x[0-9a-fA-F]{40}$/.test(expectedSigner) || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('NULL_PRIVY_AUTH_FAILED');
  const r = signature.slice(2, 66); const s = BigInt(`0x${signature.slice(66, 130)}`);
  const recovery = Number.parseInt(signature.slice(130), 16);
  if (BigInt(`0x${r}`) === 0n || BigInt(`0x${r}`) >= ORDER || s === 0n || s >= ORDER || ![0, 1, 27, 28].includes(recovery)) throw new Error('NULL_PRIVY_AUTH_FAILED');
  const compactSignature = `0x${r}${toHex(s > ORDER / 2n ? ORDER - s : s, { size: 32 }).slice(2)}` as Hex;
  try {
    const signer = await recoverAddress({ hash: digest, signature });
    const publicKey = await recoverPublicKey({ hash: digest, signature });
    if (signer.toLowerCase() !== expectedSigner.toLowerCase() || !secp256k1.verify(fromHex(compactSignature), fromHex(digest), fromHex(publicKey), { prehash: false, lowS: true })) throw new Error('NULL_PRIVY_AUTH_FAILED');
    return { digest, signer, publicKey, compactSignature };
  } catch { throw new Error('NULL_PRIVY_AUTH_FAILED'); }
}

export interface OrganizationAuthorizationResult { digest: Hex; signer: Address; publicKey: Hex; compactSignature: Hex }
/** Browser adapter: no rows, employee references, keys or private witness fields are accepted. */
export async function authorizeOrganizationDistribution(options: {
  endpoint: string;
  appId: string;
  expectedSigner: Address;
  publicInputs: readonly Hex[];
  expected: CompiledIntentContext;
  getAccessToken: () => Promise<string | null>;
  generateAuthorizationSignature: (request: AuthorizationRequest) => Promise<string | { signature: string }>;
  /** Obtain other approvers' signatures over the identical prepared request when quorum > 1. */
  collectAdditionalSignatures?: (request: AuthorizationRequest, approvalsStillNeeded: number) => Promise<readonly string[]>;
}): Promise<OrganizationAuthorizationResult> {
  validatePaymentIntent(options.publicInputs, options.expected);
  const endpoint = new URL(options.endpoint);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || (endpoint.protocol !== 'https:' && !(['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) && endpoint.protocol === 'http:'))) throw new Error('NULL_ORGANIZATION_CONFIG_REQUIRED');
  const base = endpoint.href.replace(/\/$/, '');
  const post = async (path: string, body: unknown) => {
    const token = await options.getAccessToken();
    if (!token) throw new Error('NULL_SESSION_REQUIRED');
    const response = await fetch(`${base}${path}`, { method: 'POST', credentials: 'omit', redirect: 'error', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof data.code === 'string' && /^NULL_[A-Z_]+$/.test(data.code) ? data.code : 'NULL_ORGANIZATION_UNAVAILABLE');
    return data;
  };
  const prepared = await post('/api/organization/prepare', { publicInputs: options.publicInputs, expected: { ...options.expected, chainId: options.expected.chainId.toString(), ...('kind' in options.expected ? { amountAtomic: options.expected.amountAtomic.toString() } : {}) } });
  const request = prepared.authorizationRequest as AuthorizationRequest;
  const digest = await paymentIntentDigest(options.publicInputs, options.expected);
  const expiry = Number(request?.headers?.['privy-request-expiry']);
  if (typeof prepared.ticket !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(prepared.ticket) || typeof prepared.walletAddress !== 'string' || prepared.walletAddress.toLowerCase() !== options.expectedSigner.toLowerCase() || !Number.isSafeInteger(prepared.minimumApprovals) || Number(prepared.minimumApprovals) < 1 || Number(prepared.minimumApprovals) > 20 || request?.version !== 1 || request?.method !== 'POST' || !/^https:\/\/api\.privy\.io\/v1\/wallets\/[a-zA-Z0-9_-]+\/rpc$/.test(request.url) || request.headers?.['privy-app-id'] !== options.appId || request.body?.method !== 'secp256k1_sign' || request.body.params?.hash !== digest || !Number.isSafeInteger(expiry) || String(expiry) !== request.headers['privy-request-expiry'] || expiry <= Date.now() || expiry > Date.now() + 300_000 || BigInt(expiry) > BigInt(options.publicInputs.at(-1)!) * 1000n) throw new Error('NULL_CONTEXT_MISMATCH');
  // Prevent injected fields from obtaining approval for a broader/different Privy operation.
  if (Object.keys(request).some(key => !['version', 'method', 'url', 'headers', 'body'].includes(key)) || Object.keys(request.headers).some(key => !['privy-app-id', 'privy-request-expiry'].includes(key)) || Object.keys(request.body).some(key => !['method', 'params'].includes(key)) || Object.keys(request.body.params).some(key => key !== 'hash')) throw new Error('NULL_CONTEXT_MISMATCH');
  if (Number(prepared.minimumApprovals) > 1 && !options.collectAdditionalSignatures) throw new Error('NULL_PRIVY_APPROVALS_REQUIRED');
  const generated = await options.generateAuthorizationSignature(request);
  const signature = typeof generated === 'string' ? generated : generated.signature;
  const additional = options.collectAdditionalSignatures ? await options.collectAdditionalSignatures(request, Number(prepared.minimumApprovals) - 1) : [];
  const result = await post('/api/organization/authorize', { ticket: prepared.ticket, signatures: [signature, ...additional] }) as unknown as OrganizationAuthorizationResult;
  if (result.digest !== digest || typeof result.signer !== 'string' || result.signer.toLowerCase() !== options.expectedSigner.toLowerCase() || !/^0x04[0-9a-fA-F]{128}$/.test(result.publicKey) || publicKeyToAddress(result.publicKey).toLowerCase() !== options.expectedSigner.toLowerCase() || !/^0x[0-9a-fA-F]{128}$/.test(result.compactSignature) || !secp256k1.verify(fromHex(result.compactSignature), fromHex(digest), fromHex(result.publicKey), { prehash: false, lowS: true })) throw new Error('NULL_PRIVY_AUTH_FAILED');
  return result;
}
