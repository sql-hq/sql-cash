import type { Address, Hex, TransactionReceipt, WalletClient } from 'viem';
import type { ArtifactReference, CircuitKind, ProofStage } from '@null-protocol/prover';
import type { AuthPolicyOpening, ChainContext, CompiledDistribution, DiscoveredAllocation, EnvelopeV1, ProfileKeys } from '@null-protocol/sdk';

export const CONTRACT_NAMES = ['nullPool', 'nullAuthRegistry', 'poseidon3', 'shieldVerifier', 'createDistributionVerifier', 'claimVerifier'] as const;
export type ContractName = typeof CONTRACT_NAMES[number];
export interface DeploymentManifest {
  status: 'deployed'; protocolVersion: '0.1.0' | '0.2.0' | '0.3.0'; chainId: 11155111 | 31337; deploymentBlock: number;
  asset: { symbol: string; decimals: 6; address: Address };
  contracts: Record<ContractName, Address> & { withdrawVerifier?: Address; partialWithdrawVerifier?: Address };
  codeHashes: Record<ContractName | 'asset', Hex> & { withdrawVerifier?: Hex; partialWithdrawVerifier?: Hex };
  build: { noir: '1.0.0-beta.22'; barretenberg: '5.0.0-nightly.20260522'; circuitArtifacts: Record<Exclude<CircuitKind, 'withdraw' | 'withdraw_partial'>, ArtifactReference & { verifierSourceSha256: Hex }> & { withdraw?: ArtifactReference & { verifierSourceSha256: Hex }; withdraw_partial?: ArtifactReference & { verifierSourceSha256: Hex } } };
  security: { networkScope: 'testnet-only'; withdrawalsImplemented: boolean; partialWithdrawalsImplemented?: boolean; audited: false };
}
export type OperationStage = 'deployment' | 'history' | 'authorization' | 'saving-recovery' | ProofStage | 'approval' | 'simulating' | 'submitting' | 'confirming' | 'confirmed';
export interface OperationOptions {
  signal?: AbortSignal;
  onProgress?: (stage: OperationStage) => void;
  onTransactionSubmitted?: (transaction: { hash: Hex; purpose: 'approval' | 'register-policy' | 'shield' | 'claim' | 'createDistribution' | 'withdraw' | 'withdrawPartial' }) => void;
}
export interface OwnedTreasuryNote {
  ownerNullifierKey: bigint; noteSecret: bigint; amountAtomic: bigint; policyCommitment: Hex;
  bodyCommitment: Hex; commitment: Hex; leafIndex: number; transactionHash: Hex;
}
export interface OwnedPrivateNote {
  ownerNullifierKey: bigint; noteSecret: bigint; amountAtomic: bigint; claimNullifier: Hex;
  bodyCommitment: Hex; commitment: Hex; leafIndex: number; transactionHash: Hex;
}
/** Private: implement this callback with encrypted local storage. Never upload it. */
export interface SecretCheckpoint {
  kind: 'treasury' | 'private-note'; phase: 'prepared' | 'confirmed'; context: ChainContext;
  bodyCommitment: Hex; ownerNullifierKey: bigint; noteSecret: bigint; amountAtomic: bigint;
  policyCommitment?: Hex; claimNullifier?: Hex; commitment?: Hex; leafIndex?: number; transactionHash?: Hex;
}
export interface LiveClientOptions {
  manifest: DeploymentManifest;
  rpcUrls: readonly string[];
  graphUrl?: string;
  artifactBaseUrl: string;
  confirmations?: number;
  receiptTimeoutMs?: number;
  maxGas?: bigint;
  persistLocalSecret: (checkpoint: SecretCheckpoint) => Promise<void>;
}
export type BroadcastTransport = { mode: 'wallet'; wallet: WalletClient } | { mode: 'relay'; url: string } |
  { mode: 'sponsored'; send: (operation: PublicOperation) => Promise<Hex> };
export interface PublicOperation {
  chainId: number; pool: Address; method: 'shield' | 'claim' | 'createDistribution' | 'withdraw' | 'withdrawPartial'; proof: Hex; publicInputs: Hex[];
  envelopes?: { ephemeralPubKey: Hex; viewTag: Hex; ciphertext: Hex }[];
}
export interface PreparedOperation {
  readonly publicOperation: PublicOperation;
  readonly transaction: { chainId: number; to: Address; data: Hex; value: '0x0' };
  readonly recovery: SecretCheckpoint;
  readonly createdAt: number;
}
export interface ConfirmedOperation {
  /** Public transaction checked against the exact prepared call, including supported wallet wrappers. */
  transaction?: { hash: Hex; to: Address | null; input: Hex; value: bigint };
  transactionHash: Hex; receipt: TransactionReceipt; note: OwnedTreasuryNote | OwnedPrivateNote;
  localRecoverySaved: boolean; distributionCommitment?: Hex;
  withdrawal?: { recipient: Address; amountAtomic: bigint; nullifier: Hex };
}
export type ReconciliationResult =
  | { status: 'confirmed'; result: ConfirmedOperation }
  | { status: 'pending'; transactionHash: Hex }
  | { status: 'reverted'; transactionHash: Hex; receipt: TransactionReceipt }
  | { status: 'not-observed'; explanation: string };
export interface ShieldOptions extends OperationOptions {
  amountAtomic: bigint; policyCommitment: Hex;
  /** Caller must disclose the public deposit. New deposits require an exit-capable deployment. */
  acknowledgePublicDeposit: true;
}
export interface DistributionOptions extends OperationOptions {
  compiled: CompiledDistribution; treasuryNotes: readonly OwnedTreasuryNote[]; authPolicy: AuthPolicyOpening;
  validForSeconds?: number;
  authorize: (intent: { digest: Hex; publicInputs: readonly Hex[]; context: ChainContext; commitment: Hex; envelopeRoot: Hex }) => Promise<Hex>;
}
export interface ClaimOptions extends OperationOptions { allocation: DiscoveredAllocation; validForSeconds?: number }
export interface WithdrawalOptions extends OperationOptions {
  note: OwnedPrivateNote | OwnedTreasuryNote; recipient: Address; validForSeconds?: number;
  /** Omit for a full note exit. A smaller amount requires the v0.3 recipient change verifier. */
  amountAtomic?: bigint;
  authPolicy?: AuthPolicyOpening;
  authorize?: (intent: { digest: Hex; publicInputs: readonly Hex[]; context: ChainContext; recipient: Address; amountAtomic: bigint }) => Promise<Hex>;
  acknowledgePublicWithdrawal: true;
}
export interface DiscoveryOptions extends OperationOptions { keys: ProfileKeys; forceRpc?: boolean }
export interface PublicHistory {
  blockNumber: bigint; blockHash: Hex; source: 'graph' | 'rpc';
  noteLeaves: Hex[]; distributionLeaves: Hex[]; policyLeaves: Hex[];
  envelopes: EnvelopeV1[];
  distributions: { commitment: Hex; envelopeRoot: Hex; transportTag: Hex; leafIndex: number; confirmed: boolean; expiry: '0' }[];
}
