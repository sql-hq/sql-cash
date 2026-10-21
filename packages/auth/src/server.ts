import { Buffer } from 'node:buffer';
import type { Address, Hex } from 'viem';
import { createPrivyAuthorizationRequest, organizationIdentityRequest, verifyPrivyIntentSignature, type AuthorizationRequest, type CompiledIntentContext } from './index.js';

export interface PrivyOrganizationConfig {
  appId: string;
  appSecret: string;
  walletId: string;
  walletAddress: Address;
  ownerQuorumId: string;
  requiredPolicyIds: readonly string[];
  /** Explicit owner-only control for raw signing, which has no policy rule method. */
  controlMode?: 'policies-and-quorum' | 'owner-quorum';
  expectedOwnerUserIds?: readonly string[];
  /** The organization entity assigned to this business treasury wallet. */
  organizationEntityId: string;
  minimumApprovals: number;
  chainId: bigint;
  poolAddress: Address;
}
/** Server-only adapter. Hosts must authenticate organization membership before invoking it. */
export function createPrivyOrganizationAuthorizer(configuration: PrivyOrganizationConfig) {
  const config = { ...configuration, requiredPolicyIds: [...configuration.requiredPolicyIds], expectedOwnerUserIds: configuration.expectedOwnerUserIds ? [...configuration.expectedOwnerUserIds] : undefined };
  const identifier = /^[a-zA-Z0-9_-]+$/;
  const address = /^0x[0-9a-fA-F]{40}$/;
  const ownerOnly = config.controlMode === 'owner-quorum';
  if (config.controlMode !== undefined && !['policies-and-quorum', 'owner-quorum'].includes(config.controlMode)) throw new Error('NULL_PRIVY_CONFIG_REQUIRED');
  if (ownerOnly && config.minimumApprovals > (config.expectedOwnerUserIds?.length ?? 0)) throw new Error('NULL_PRIVY_CONFIG_REQUIRED');
  if (!config.appSecret || ![config.appId, config.walletId, config.ownerQuorumId, config.organizationEntityId, ...config.requiredPolicyIds].every(value => typeof value === 'string' && identifier.test(value)) || (!ownerOnly && !config.requiredPolicyIds.length) || (ownerOnly && (config.requiredPolicyIds.length !== 0 || !config.expectedOwnerUserIds?.length || config.expectedOwnerUserIds.some(id => !/^did:privy:[a-zA-Z0-9]+$/.test(id)) || new Set(config.expectedOwnerUserIds).size !== config.expectedOwnerUserIds.length)) || new Set(config.requiredPolicyIds).size !== config.requiredPolicyIds.length || !Number.isSafeInteger(config.minimumApprovals) || config.minimumApprovals < 1 || config.minimumApprovals > 20 || config.chainId <= 0n || ![config.walletAddress, config.poolAddress].every(value => address.test(value) && BigInt(value) !== 0n)) throw new Error('NULL_PRIVY_CONFIG_REQUIRED');
  const headers = { 'privy-app-id': config.appId, Authorization: `Basic ${Buffer.from(`${config.appId}:${config.appSecret}`).toString('base64')}` };
  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(`https://api.privy.io/v1/${path}`, { ...init, headers: { ...headers, ...init.headers }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error('NULL_PRIVY_AUTH_FAILED');
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('NULL_PRIVY_AUTH_FAILED');
    return data;
  }
  async function verifyWalletControl() {
    const wallet = await request(`wallets/${encodeURIComponent(config.walletId)}`) as { id: string; address: string; chain_type: string; owner_id: string; policy_ids: string[]; entity?: { type: string; id: string }; archived_at?: number | null; additional_signers: unknown[]; public_key?: string };
    if (wallet.id !== config.walletId || wallet.chain_type !== 'ethereum' || typeof wallet.address !== 'string' || !address.test(wallet.address) || wallet.address.toLowerCase() !== config.walletAddress.toLowerCase() || wallet.owner_id !== config.ownerQuorumId || wallet.entity?.type !== 'organization' || wallet.entity.id !== config.organizationEntityId || wallet.archived_at != null || !Array.isArray(wallet.policy_ids) || wallet.policy_ids.length !== config.requiredPolicyIds.length || !config.requiredPolicyIds.every(policy => wallet.policy_ids.includes(policy))) throw new Error('NULL_PRIVY_CONTROL_MISMATCH');
    // A bypass signer can defeat the declared quorum; require an owner-only treasury.
    if (!Array.isArray(wallet.additional_signers) || wallet.additional_signers.length) throw new Error('NULL_PRIVY_CONTROL_MISMATCH');
    const quorum = await request(`key_quorums/${encodeURIComponent(config.ownerQuorumId)}`) as { id: string; authorization_threshold: number | null; user_ids?: string[]; authorization_keys?: unknown[]; key_quorum_ids?: string[] };
    if (quorum.id !== config.ownerQuorumId || !Number.isSafeInteger(quorum.authorization_threshold) || Number(quorum.authorization_threshold) !== config.minimumApprovals) throw new Error('NULL_PRIVY_CONTROL_MISMATCH');
    if (ownerOnly && (!Array.isArray(quorum.user_ids) || quorum.user_ids.length !== config.expectedOwnerUserIds!.length || !config.expectedOwnerUserIds!.every(id => quorum.user_ids!.includes(id)) || quorum.authorization_keys?.length || quorum.key_quorum_ids?.length || config.minimumApprovals > quorum.user_ids.length)) throw new Error('NULL_PRIVY_CONTROL_MISMATCH');
    return wallet;
  }
  async function signRequest(canonical: AuthorizationRequest, signatures: readonly string[]) {
    if (!Array.isArray(signatures) || signatures.length < config.minimumApprovals || signatures.length > 20 || new Set(signatures).size !== signatures.length || signatures.some(signature => typeof signature !== 'string' || !signature.length || signature.length > 8_192 || Buffer.from(signature, 'base64').toString('base64') !== signature)) throw new Error('NULL_PRIVY_APPROVALS_REQUIRED');
    await verifyWalletControl();
    const result = await request(`wallets/${encodeURIComponent(config.walletId)}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', ...canonical.headers, 'privy-authorization-signature': signatures.join(',') }, body: JSON.stringify(canonical.body) }) as { method: string; data?: { encoding: string; signature: Hex } };
    if (result.method !== 'secp256k1_sign' || result.data?.encoding !== 'hex' || typeof result.data.signature !== 'string') throw new Error('NULL_PRIVY_AUTH_FAILED');
    return verifyPrivyIntentSignature(canonical.body.params.hash, result.data.signature, config.walletAddress);
  }
  return {
    verifyWalletControl,
    async prepareIdentity() { await verifyWalletControl(); return organizationIdentityRequest(config); },
    async identify(requestExpiryMs: number, signatures: readonly string[]) { return signRequest(organizationIdentityRequest({ ...config, requestExpiryMs }), signatures); },
    async prepare(publicInputs: readonly Hex[], expected: CompiledIntentContext): Promise<AuthorizationRequest> {
      if (expected.chainId !== config.chainId || expected.poolAddress.toLowerCase() !== config.poolAddress.toLowerCase()) throw new Error('NULL_CONTEXT_MISMATCH');
      await verifyWalletControl();
      return createPrivyAuthorizationRequest({ appId: config.appId, walletId: config.walletId, publicInputs, expected });
    },
    async authorize(options: { publicInputs: readonly Hex[]; expected: CompiledIntentContext; requestExpiryMs: number; signatures: readonly string[] }) {
      if (options.expected.chainId !== config.chainId || options.expected.poolAddress.toLowerCase() !== config.poolAddress.toLowerCase()) throw new Error('NULL_CONTEXT_MISMATCH');
      // Privy's SDK returns base64 authorization signatures. Reject alternate encodings,
      // separators and duplicate encodings before Privy checks the actual quorum keys.
      if (!Array.isArray(options.signatures) || options.signatures.length < config.minimumApprovals || options.signatures.length > 20 || new Set(options.signatures).size !== options.signatures.length || options.signatures.some(signature => typeof signature !== 'string' || !signature.length || signature.length > 8_192 || Buffer.from(signature, 'base64').toString('base64') !== signature)) throw new Error('NULL_PRIVY_APPROVALS_REQUIRED');
      await verifyWalletControl();
      // Rebuild the exact request. The host cannot supply another URL, wallet, method or digest.
      const canonical = await createPrivyAuthorizationRequest({ appId: config.appId, walletId: config.walletId, publicInputs: options.publicInputs, expected: options.expected, requestExpiryMs: options.requestExpiryMs });
      const result = await request(`wallets/${encodeURIComponent(config.walletId)}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', ...canonical.headers, 'privy-authorization-signature': options.signatures.join(',') }, body: JSON.stringify(canonical.body) }) as { method: string; data?: { encoding: string; signature: Hex } };
      if (result.method !== 'secp256k1_sign' || result.data?.encoding !== 'hex' || typeof result.data.signature !== 'string') throw new Error('NULL_PRIVY_AUTH_FAILED');
      return verifyPrivyIntentSignature(canonical.body.params.hash, result.data.signature, config.walletAddress);
    },
  };
}
