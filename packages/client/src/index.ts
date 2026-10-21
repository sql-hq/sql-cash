import {
  createPublicClient, decodeEventLog, defineChain, encodeFunctionData, fallback, http, keccak256, parseAbi, TransactionReceiptNotFoundError,
  type Address, type Hex, type TransactionReceipt, type WalletClient,
} from 'viem';
import { nullAuthRegistryAbi, nullPoolAbi } from '@null-protocol/contracts';
import { createDiscoveryClient } from '@null-protocol/graph-client';
import { proveInWorker, type CircuitKind, type ProofRequest } from '@null-protocol/prover';
import {
  NullError, IncrementalMerkleTree, authPolicyCommitment, buildClaimWitness, buildCreateDistributionWitness,
  buildShieldWitness, buildPrivateNote, buildWithdrawalWitness, buildPartialWithdrawalWitness, prepareWithdrawalIntent, privateNoteBody, deriveField, fieldFromHex, fieldHex, finalNoteCommitment, fromHex, noteNullifier,
  prepareDistributionIntent, randomBytes, scanEnvelopes, treasuryNoteBody, utf8,
  type AuthPolicyOpening, type ChainContext, type PreparedWitness,
} from '@null-protocol/sdk';
import {
  CONTRACT_NAMES, type BroadcastTransport, type ClaimOptions, type ConfirmedOperation, type DeploymentManifest,
  type DiscoveryOptions, type DistributionOptions, type LiveClientOptions, type OperationOptions,
  type OperationStage, type OwnedPrivateNote, type OwnedTreasuryNote, type PreparedOperation,
  type WithdrawalOptions, type PublicHistory, type PublicOperation, type ReconciliationResult, type SecretCheckpoint, type ShieldOptions,
} from './types';
export * from './types';
export * from './storage';
export { matchesSubmittedCall } from './transaction-match';
import { matchesSubmittedCall } from './transaction-match';

const tokenAbi = parseAbi([
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner,address spender) view returns (uint256)',
  'function approve(address spender,uint256 amount) returns (bool)',
]);
const policyRegisteredEvent = parseAbi(['event PolicyRegistered(uint256 indexed policyCommitment, uint256 indexed policyIndex, uint256 postAuthRoot)'])[0];
type RelayEnvelope = NonNullable<PublicOperation['envelopes']>[number];
type EightEnvelopes = [RelayEnvelope, RelayEnvelope, RelayEnvelope, RelayEnvelope, RelayEnvelope, RelayEnvelope, RelayEnvelope, RelayEnvelope];
function requireHex(value: unknown, bytes: number): asserts value is Hex {
  if (typeof value !== 'string') throw new NullError('NULL_DEPLOYMENT_UNAVAILABLE', 'The deployment manifest is incomplete.');
  fromHex(value, bytes);
  if (BigInt(value) === 0n) throw new NullError('NULL_DEPLOYMENT_UNAVAILABLE', 'Deployment addresses and checksums must be nonzero.');
}
function secureUrl(value: string, base?: string): string {
  let url: URL; try { url = new URL(value, base); } catch { throw new NullError('NULL_ENDPOINT_INVALID', 'Configure a valid endpoint URL.'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new NullError('NULL_ENDPOINT_INVALID', 'Live endpoints require HTTPS.');
  if (url.username || url.password) throw new NullError('NULL_ENDPOINT_INVALID', 'Endpoint URLs must not contain user credentials.');
  return url.toString();
}
export function validateDeploymentManifest(manifest: DeploymentManifest): void {
  if (manifest?.security?.partialWithdrawalsImplemented) {
    if (manifest.protocolVersion !== '0.3.0' || !manifest.security.withdrawalsImplemented) throw new NullError('NULL_DEPLOYMENT_UNAVAILABLE', 'Partial withdrawals require a v0.3 pool with an exit verifier.');
    requireHex(manifest.contracts.partialWithdrawVerifier, 20); requireHex(manifest.codeHashes.partialWithdrawVerifier, 32);
    const artifact = manifest.build?.circuitArtifacts?.withdraw_partial;
    if (!artifact?.url || artifact.verifierTarget !== 'evm' || artifact.noirVersion !== manifest.build.noir || artifact.backendVersion !== manifest.build.barretenberg) throw new NullError('NULL_ARTIFACT_UNAVAILABLE', 'Partial withdrawal artifacts are missing.');
    requireHex(artifact.sha256, 32); requireHex(artifact.verificationKeySha256, 32); requireHex(artifact.verifierSourceSha256, 32);
  }
  if (manifest.status !== 'deployed' || !['0.1.0', '0.2.0', '0.3.0'].includes(manifest.protocolVersion) || ![11155111, 31337].includes(manifest.chainId) || !Number.isSafeInteger(manifest.deploymentBlock) || manifest.deploymentBlock < 0 || manifest.asset?.decimals !== 6 || manifest.security?.networkScope !== 'testnet-only') throw new NullError('NULL_DEPLOYMENT_UNAVAILABLE', 'A complete testnet deployment manifest is required.');
  for (const name of CONTRACT_NAMES) { requireHex(manifest.contracts?.[name], 20); requireHex(manifest.codeHashes?.[name], 32); }
  if (manifest.security.withdrawalsImplemented) {
    if (!['0.2.0', '0.3.0'].includes(manifest.protocolVersion)) throw new NullError('NULL_DEPLOYMENT_UNAVAILABLE', 'Withdrawals require a version 0.2 deployment.');
    requireHex(manifest.contracts.withdrawVerifier, 20); requireHex(manifest.codeHashes.withdrawVerifier, 32);
    const artifact = manifest.build?.circuitArtifacts?.withdraw;
    if (!artifact?.url || artifact.verifierTarget !== 'evm' || artifact.noirVersion !== manifest.build.noir || artifact.backendVersion !== manifest.build.barretenberg) throw new NullError('NULL_ARTIFACT_UNAVAILABLE', 'The withdrawal verifier is not configured.');
    requireHex(artifact.sha256, 32); requireHex(artifact.verificationKeySha256, 32); requireHex(artifact.verifierSourceSha256, 32);
  }
  requireHex(manifest.asset.address, 20); requireHex(manifest.codeHashes.asset, 32);
  if (manifest.build?.noir !== '1.0.0-beta.22' || manifest.build.barretenberg !== '5.0.0-nightly.20260522') throw new NullError('NULL_ARTIFACT_MISMATCH', 'The deployment uses an unsupported proving toolchain.');
  for (const kind of ['shield', 'create_distribution', 'claim'] as const) {
    const artifact = manifest.build.circuitArtifacts?.[kind];
    if (!artifact?.url || artifact.noirVersion !== manifest.build.noir || artifact.backendVersion !== manifest.build.barretenberg || artifact.verifierTarget !== 'evm') throw new NullError('NULL_ARTIFACT_UNAVAILABLE', 'All three ZK-enabled proving artifacts must be configured.');
    requireHex(artifact.sha256, 32); requireHex(artifact.verificationKeySha256, 32); requireHex(artifact.verifierSourceSha256, 32);
  }
}

/** A transaction may be submitted even if the endpoint failed before returning its hash. */
export class SubmissionUncertainError extends NullError {
  readonly publicOperation: PublicOperation;
  readonly transactionHash?: Hex;
  constructor(operation: PublicOperation, transactionHash?: Hex) {
    super('NULL_SUBMISSION_UNCERTAIN', 'Submission could not be confirmed. Reconcile the public transaction and nullifiers before retrying.');
    this.publicOperation = structuredClone(operation); this.transactionHash = transactionHash;
  }
}
export function exportPublicOperation(prepared: PreparedOperation): string {
  const value = prepared.publicOperation;
  return JSON.stringify({ chainId: value.chainId, pool: value.pool, method: value.method, proof: value.proof, publicInputs: [...value.publicInputs],
    ...(value.envelopes ? { envelopes: value.envelopes.map(({ ephemeralPubKey, viewTag, ciphertext }) => ({ ephemeralPubKey, viewTag, ciphertext })) } : {}),
  }, null, 2);
}
const partialAbi = parseAbi([
  'function withdrawPartial(bytes proof, bytes32[] inputs)',
  'function partialWithdrawVerifier() view returns (address)',
  'function partialWithdrawVerifierCodeHash() view returns (bytes32)',
]);
export function encodePublicOperation(operation: PublicOperation): Hex {
  if (operation.method === 'withdrawPartial') return encodeFunctionData({ abi: partialAbi, functionName: 'withdrawPartial', args: [operation.proof, operation.publicInputs] });
  if (operation.method === 'createDistribution') {
    if (operation.envelopes?.length !== 8) throw new NullError('NULL_SLOT_COUNT_INVALID', 'Expected eight delivery envelopes.');
    return encodeFunctionData({ abi: nullPoolAbi, functionName: 'createDistribution', args: [operation.proof, operation.publicInputs, operation.envelopes as EightEnvelopes] });
  }
  return encodeFunctionData({ abi: nullPoolAbi, functionName: operation.method, args: [operation.proof, operation.publicInputs] });
}
function progress(options: OperationOptions, stage: OperationStage): void { try { options.onProgress?.(stage); } catch { /* UI callbacks do not alter protocol state. */ } }
function submitted(options: OperationOptions, hash: Hex, purpose: Parameters<NonNullable<OperationOptions['onTransactionSubmitted']>>[0]['purpose']): void {
  try { options.onTransactionSubmitted?.({ hash, purpose }); } catch { /* Submitted hashes remain observable from receipts. */ }
}
function checkAbort(options: OperationOptions): void { options.signal?.throwIfAborted(); }
function newField(label: string): bigint { const entropy = randomBytes(32); try { return deriveField(entropy, utf8(label)); } finally { entropy.fill(0); } }
function walletRequestRejected(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth++) {
    const candidate = current as { code?: unknown; name?: unknown; cause?: unknown };
    if (candidate.code === 4001 || candidate.name === 'UserRejectedRequestError') return true;
    current = candidate.cause;
  }
  return false;
}

/** Browser-only orchestration. All witness construction and proving remain on this device. */
export class NullLiveClient {
  readonly context: ChainContext;
  private readonly manifest: DeploymentManifest;
  private readonly rpc: ReturnType<typeof createPublicClient>;
  private readonly discovery: ReturnType<typeof createDiscoveryClient>;
  private readonly options: LiveClientOptions;
  private readonly chain: ReturnType<typeof defineChain>;
  private readonly prepared = new WeakMap<PreparedOperation, { operation: PublicOperation; recovery: SecretCheckpoint }>();
  private readonly submitting = new WeakSet<PreparedOperation>();
  private readonly completed = new WeakSet<PreparedOperation>();
  private readonly uncertain = new WeakSet<PreparedOperation>();

  constructor(options: LiveClientOptions) {
    validateDeploymentManifest(options.manifest);
    if (!options.rpcUrls.length || typeof options.persistLocalSecret !== 'function') throw new NullError('NULL_CONFIGURATION_INVALID', 'RPC access and encrypted local recovery storage are required.');
    const confirmations = options.confirmations ?? 12;
    if (!Number.isSafeInteger(confirmations) || confirmations < 1) throw new NullError('NULL_CONFIGURATION_INVALID', 'At least one confirmation is required.');
    this.manifest = structuredClone(options.manifest);
    for (const kind of ['shield', 'create_distribution', 'claim'] as const) this.manifest.build.circuitArtifacts[kind].url = secureUrl(this.manifest.build.circuitArtifacts[kind].url, options.artifactBaseUrl);
    if (this.manifest.security.withdrawalsImplemented) this.manifest.build.circuitArtifacts.withdraw!.url = secureUrl(this.manifest.build.circuitArtifacts.withdraw!.url, options.artifactBaseUrl);
    if (this.manifest.security.partialWithdrawalsImplemented) this.manifest.build.circuitArtifacts.withdraw_partial!.url = secureUrl(this.manifest.build.circuitArtifacts.withdraw_partial!.url, options.artifactBaseUrl);
    const rpcUrls = options.rpcUrls.map(url => secureUrl(url));
    this.options = { ...options, rpcUrls, confirmations, receiptTimeoutMs: options.receiptTimeoutMs ?? 180_000, maxGas: options.maxGas ?? 10_000_000n };
    this.context = Object.freeze({ chainId: BigInt(this.manifest.chainId), poolAddress: this.manifest.contracts.nullPool });
    this.chain = defineChain({ id: this.manifest.chainId, name: this.manifest.chainId === 11155111 ? 'Sepolia' : 'NULL local development', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: rpcUrls } } });
    this.rpc = createPublicClient({ transport: fallback(rpcUrls.map(url => http(url, { timeout: 15_000, retryCount: 1 }))) });
    this.discovery = createDiscoveryClient({ chainId: this.manifest.chainId, pool: this.manifest.contracts.nullPool, fromBlock: BigInt(this.manifest.deploymentBlock), rpcUrls, graphUrl: options.graphUrl ? secureUrl(options.graphUrl) : undefined, confirmations });
  }

  async verifyDeployment(options: OperationOptions = {}): Promise<void> {
    progress(options, 'deployment'); checkAbort(options);
    if (await this.rpc.getChainId() !== this.manifest.chainId) throw new NullError('NULL_CONTEXT_MISMATCH', 'The RPC chain does not match the pinned deployment.');
    await Promise.all([...CONTRACT_NAMES, 'asset' as const].map(async name => {
      const address = name === 'asset' ? this.manifest.asset.address : this.manifest.contracts[name];
      const code = await this.rpc.getCode({ address });
      if (!code || code === '0x' || keccak256(code).toLowerCase() !== this.manifest.codeHashes[name].toLowerCase()) throw new NullError('NULL_VERIFIER_MISMATCH', 'Deployed runtime code does not match the pinned manifest.');
    }));
    if (this.manifest.security.partialWithdrawalsImplemented) {
      const verifier = this.manifest.contracts.partialWithdrawVerifier!;
      const code = await this.rpc.getCode({ address: verifier });
      const address = await this.rpc.readContract({ address: this.context.poolAddress, abi: partialAbi, functionName: 'partialWithdrawVerifier' });
      const hash = await this.rpc.readContract({ address: this.context.poolAddress, abi: partialAbi, functionName: 'partialWithdrawVerifierCodeHash' });
      if (!code || keccak256(code) !== this.manifest.codeHashes.partialWithdrawVerifier || address.toLowerCase() !== verifier.toLowerCase() || hash !== this.manifest.codeHashes.partialWithdrawVerifier) throw new NullError('NULL_VERIFIER_MISMATCH', 'Partial withdrawal code does not match the deployment.');
    }
    if (this.manifest.security.withdrawalsImplemented) {
      const verifier = this.manifest.contracts.withdrawVerifier!;
      const code = await this.rpc.getCode({address:verifier});
      const [address, hash] = await Promise.all([this.rpc.readContract({address:this.context.poolAddress,abi:nullPoolAbi,functionName:'withdrawVerifier'}),this.rpc.readContract({address:this.context.poolAddress,abi:nullPoolAbi,functionName:'withdrawVerifierCodeHash'})]);
      if (!code || keccak256(code) !== this.manifest.codeHashes.withdrawVerifier || address.toLowerCase() !== verifier.toLowerCase() || hash !== this.manifest.codeHashes.withdrawVerifier) throw new NullError('NULL_VERIFIER_MISMATCH', 'Withdrawal code does not match the deployment.');
    }
    const dependencies = { ASSET: this.manifest.asset.address, AUTH_REGISTRY: this.manifest.contracts.nullAuthRegistry, HASHER: this.manifest.contracts.poseidon3, shieldVerifier: this.manifest.contracts.shieldVerifier, createDistributionVerifier: this.manifest.contracts.createDistributionVerifier, claimVerifier: this.manifest.contracts.claimVerifier } as const;
    for (const [name, expected] of Object.entries(dependencies)) {
      const actual = await this.rpc.readContract({ address: this.manifest.contracts.nullPool, abi: nullPoolAbi, functionName: name as keyof typeof dependencies });
      if (String(actual).toLowerCase() !== expected.toLowerCase()) throw new NullError('NULL_VERIFIER_MISMATCH', 'The pool dependency does not match the reviewed deployment.');
    }
    for (const name of ['shieldVerifier', 'createDistributionVerifier', 'claimVerifier'] as const) {
      const hash = await this.rpc.readContract({ address: this.manifest.contracts.nullPool, abi: nullPoolAbi, functionName: `${name}CodeHash` });
      if (hash.toLowerCase() !== this.manifest.codeHashes[name].toLowerCase()) throw new NullError('NULL_VERIFIER_MISMATCH', 'The pool has a different immutable verifier hash.');
    }
    const [decimals, version, slots, size, registryHasher] = await Promise.all([
      this.rpc.readContract({ address: this.manifest.asset.address, abi: tokenAbi, functionName: 'decimals' }),
      this.rpc.readContract({ address: this.manifest.contracts.nullPool, abi: nullPoolAbi, functionName: 'PROTOCOL_VERSION' }),
      this.rpc.readContract({ address: this.manifest.contracts.nullPool, abi: nullPoolAbi, functionName: 'DISTRIBUTION_SLOTS' }),
      this.rpc.readContract({ address: this.manifest.contracts.nullPool, abi: nullPoolAbi, functionName: 'CIPHERTEXT_BYTES' }),
      this.rpc.readContract({ address: this.manifest.contracts.nullAuthRegistry, abi: nullAuthRegistryAbi, functionName: 'HASHER' }),
    ]);
    if (decimals !== 6 || version !== 1n || slots !== 8n || size !== 540n || registryHasher.toLowerCase() !== this.manifest.contracts.poseidon3.toLowerCase()) throw new NullError('NULL_CONTEXT_MISMATCH', 'Deployment protocol parameters do not match this client.');
    checkAbort(options);
  }

  async syncHistory(options: OperationOptions & { forceRpc?: boolean } = {}): Promise<PublicHistory> {
    try { return await this.syncHistoryFromSource(options); }
    catch (error) {
      // Transport fallback cannot detect a successful but incomplete eth_getLogs
      // response. Replay on each remaining provider and verify the entire snapshot.
      checkAbort(options);
      if (!(error instanceof NullError) || error.code !== 'NULL_HISTORY_INCOMPLETE') throw error;
      let lastError: unknown = error;
      for (const rpcUrl of [...new Set(this.options.rpcUrls)].slice(1)) {
        checkAbort(options);
        const alternate = new NullLiveClient({ ...this.options, rpcUrls: [rpcUrl], graphUrl: undefined });
        try { return await alternate.syncHistoryFromSource({ ...options, forceRpc: true }); }
        catch (reason) { checkAbort(options); lastError = reason; }
      }
      throw lastError;
    }
  }

  private async syncHistoryFromSource(options: OperationOptions & { forceRpc?: boolean }): Promise<PublicHistory> {
    progress(options, 'history'); checkAbort(options);
    const page = await this.discovery.scan({ forceRpc: options.forceRpc });
    if (page.checkpoint.blockNumber > page.confirmedToBlock) throw new NullError('NULL_HISTORY_UNCONFIRMED', 'Wait for the deployment history to reach the configured confirmation threshold.');
    try {
      const noteLeaves = page.notes.map((note, index) => { if (note.noteIndex !== index) throw new Error('Missing note history'); return note.commitment; });
      const distributionLeaves = page.distributions.map((distribution, index) => { if (distribution.leafIndex !== index) throw new Error('Missing distribution history'); return distribution.commitment; });
      const policyLeaves: Hex[] = [];
      for (let fromBlock = BigInt(this.manifest.deploymentBlock); fromBlock <= page.checkpoint.blockNumber; fromBlock += 2_000n) {
        checkAbort(options);
        const toBlock = fromBlock + 1_999n < page.checkpoint.blockNumber ? fromBlock + 1_999n : page.checkpoint.blockNumber;
        const logs = await this.rpc.getLogs({ address: this.manifest.contracts.nullAuthRegistry, event: policyRegisteredEvent, fromBlock, toBlock, strict: true });
        for (const log of logs) {
          if (log.removed) continue;
          let decoded: { eventName: string; args: Record<string, unknown> };
          try { decoded = decodeEventLog({ abi: nullAuthRegistryAbi, data: log.data, topics: log.topics }) as unknown as typeof decoded; } catch { continue; }
          if (decoded.eventName === 'PolicyRegistered') {
            if (Number(decoded.args.policyIndex) !== policyLeaves.length) throw new Error('Missing authorization history');
            policyLeaves.push(fieldHex(BigInt(String(decoded.args.policyCommitment))));
          }
        }
      }
      const blockNumber = page.checkpoint.blockNumber;
      const [noteRoot, distributionRoot, authRoot, noteCount, distributionCount, policyCount] = await Promise.all([
        this.rpc.readContract({ address: this.manifest.contracts.nullPool, abi: nullPoolAbi, functionName: 'noteRoot', blockNumber }),
        this.rpc.readContract({ address: this.manifest.contracts.nullPool, abi: nullPoolAbi, functionName: 'distributionRoot', blockNumber }),
        this.rpc.readContract({ address: this.manifest.contracts.nullAuthRegistry, abi: nullAuthRegistryAbi, functionName: 'authRoot', blockNumber }),
        this.rpc.readContract({ address: this.manifest.contracts.nullPool, abi: nullPoolAbi, functionName: 'nextNoteIndex', blockNumber }),
        this.rpc.readContract({ address: this.manifest.contracts.nullPool, abi: nullPoolAbi, functionName: 'nextDistributionIndex', blockNumber }),
        this.rpc.readContract({ address: this.manifest.contracts.nullAuthRegistry, abi: nullAuthRegistryAbi, functionName: 'nextPolicyIndex', blockNumber }),
      ]);
      if (BigInt(noteLeaves.length) !== noteCount || BigInt(distributionLeaves.length) !== distributionCount || BigInt(policyLeaves.length) !== policyCount ||
        new IncrementalMerkleTree(20, noteLeaves).root !== fieldHex(noteRoot) || new IncrementalMerkleTree(20, distributionLeaves).root !== fieldHex(distributionRoot) || new IncrementalMerkleTree(20, policyLeaves).root !== fieldHex(authRoot)) throw new Error('Accumulator mismatch');
      const canonical = await this.rpc.getBlock({ blockNumber });
      if (canonical.hash !== page.checkpoint.blockHash) throw new NullError('NULL_ROOT_STALE', 'Chain history changed while reconstructing the accumulators.');
      return { blockNumber, blockHash: page.checkpoint.blockHash, source: page.source, noteLeaves, distributionLeaves, policyLeaves, envelopes: page.envelopes, distributions: page.distributions };
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (page.source === 'graph' && !options.forceRpc) return this.syncHistoryFromSource({ ...options, forceRpc: true });
      if (error instanceof NullError) throw error;
      throw new NullError('NULL_HISTORY_INCOMPLETE', 'Public history does not reconstruct the onchain accumulators. Change RPC provider and rescan.');
    }
  }

  async discover(options: DiscoveryOptions) {
    await this.verifyDeployment(options); const history = await this.syncHistory(options);
    const allocations = await scanEnvelopes({ envelopes: history.envelopes, distributions: history.distributions, keys: options.keys, context: this.context, source: 'chain', signal: options.signal });
    return await Promise.all(allocations.map(async allocation => ({ ...allocation, spent: await this.rpc.readContract({ address: this.manifest.contracts.nullPool, abi: nullPoolAbi, functionName: 'spentClaimNullifier', args: [fieldFromHex(allocation.id)] }) })));
  }

  async registerPolicy(options: OperationOptions & { opening: AuthPolicyOpening; wallet: WalletClient; persistLocalPolicy: (opening: AuthPolicyOpening) => Promise<void> }): Promise<{ policyCommitment: Hex; policyIndex: number; transactionHash?: Hex }> {
    await this.verifyDeployment(options);
    const policyCommitment = authPolicyCommitment(options.opening);
    const account = await this.walletAccount(options.wallet);
    progress(options, 'saving-recovery'); checkAbort(options);
    await options.persistLocalPolicy(structuredClone(options.opening));
    const registered = await this.rpc.readContract({ address: this.manifest.contracts.nullAuthRegistry, abi: nullAuthRegistryAbi, functionName: 'registered', args: [fieldFromHex(policyCommitment)] });
    if (registered) {
      const history = await this.syncHistory(options); const policyIndex = history.policyLeaves.indexOf(policyCommitment);
      if (policyIndex < 0) throw new NullError('NULL_POLICY_UNCONFIRMED', 'The policy exists but is not yet confirmed.');
      return { policyCommitment, policyIndex };
    }
    const data = encodeFunctionData({ abi: nullAuthRegistryAbi, functionName: 'register', args: [fieldFromHex(policyCommitment)] });
    progress(options, 'simulating'); await this.rpc.call({ account, to: this.manifest.contracts.nullAuthRegistry, data });
    checkAbort(options); progress(options, 'submitting');
    const hash = await options.wallet.sendTransaction({ account: options.wallet.account ?? account, chain: this.chain, to: this.manifest.contracts.nullAuthRegistry, data, value: 0n });
    submitted(options, hash, 'register-policy'); progress(options, 'confirming');
    const receipt = await this.rpc.waitForTransactionReceipt({ hash, confirmations: this.options.confirmations, timeout: this.options.receiptTimeoutMs });
    if (receipt.status !== 'success') throw new NullError('NULL_POLICY_REGISTRATION_FAILED', 'The policy registration transaction reverted.');
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== this.manifest.contracts.nullAuthRegistry.toLowerCase()) continue;
      try {
        const event = decodeEventLog({ abi: nullAuthRegistryAbi, data: log.data, topics: log.topics });
        if (event.eventName === 'PolicyRegistered' && event.args.policyCommitment === fieldFromHex(policyCommitment)) {
          progress(options, 'confirmed'); return { policyCommitment, policyIndex: Number(event.args.policyIndex), transactionHash: receipt.transactionHash };
        }
      } catch { /* inspect remaining registry logs */ }
    }
    throw new NullError('NULL_TRANSACTION_MISMATCH', 'The confirmed transaction did not register the expected policy.');
  }

  /** Wait for an already submitted activation; never send a second registration. */
  async reconcilePolicyRegistration(policyCommitment: Hex, hash: Hex, options: OperationOptions = {}) {
    await this.verifyDeployment(options);
    progress(options, 'confirming');
    const receipt = await this.rpc.waitForTransactionReceipt({ hash, confirmations: this.options.confirmations, timeout: this.options.receiptTimeoutMs });
    if (receipt.status !== 'success') throw new NullError('NULL_POLICY_REGISTRATION_FAILED', 'Organization activation failed on the network.');
    const transaction = await this.rpc.getTransaction({ hash: receipt.transactionHash });
    const expected = encodeFunctionData({ abi: nullAuthRegistryAbi, functionName: 'register', args: [fieldFromHex(policyCommitment)] });
    if (!matchesSubmittedCall(transaction, this.manifest.contracts.nullAuthRegistry, expected)) throw new NullError('NULL_TRANSACTION_MISMATCH', 'The transaction is not this organization activation.');
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== this.manifest.contracts.nullAuthRegistry.toLowerCase()) continue;
      try {
        const event = decodeEventLog({ abi: nullAuthRegistryAbi, data: log.data, topics: log.topics });
        if (event.eventName === 'PolicyRegistered' && event.args.policyCommitment === fieldFromHex(policyCommitment)) {
          return { policyCommitment, policyIndex: Number(event.args.policyIndex), transactionHash: receipt.transactionHash };
        }
      } catch { /* inspect remaining registry logs */ }
    }
    throw new NullError('NULL_TRANSACTION_MISMATCH', 'The activation did not register this organization setup.');
  }

  /** Recover funded/change notes from saved encrypted-local checkpoints and public history. */
  async recoverTreasuryNotes(checkpoints: readonly SecretCheckpoint[], options: OperationOptions = {}): Promise<{ note: OwnedTreasuryNote; spent: boolean }[]> {
    await this.verifyDeployment(options); const history = await this.syncHistory(options); const recovered: { note: OwnedTreasuryNote; spent: boolean }[] = [];
    const seen = new Set<Hex>();
    for (const checkpoint of checkpoints) {
      checkAbort(options);
      if (checkpoint.kind !== 'treasury' || checkpoint.context.chainId !== this.context.chainId || checkpoint.context.poolAddress.toLowerCase() !== this.context.poolAddress.toLowerCase() || !checkpoint.policyCommitment) continue;
      const body = treasuryNoteBody(checkpoint.ownerNullifierKey, checkpoint.policyCommitment, checkpoint.amountAtomic, checkpoint.noteSecret);
      if (body !== checkpoint.bodyCommitment || seen.has(body)) continue;
      seen.add(body);
      // Shield proofs can be deliberately reused for another funded deposit. Each
      // final index creates a distinct owned note even when the hidden body repeats.
      for (let leafIndex = 0; leafIndex < history.noteLeaves.length; leafIndex++) {
        const commitment = history.noteLeaves[leafIndex]!;
        if (finalNoteCommitment(body, leafIndex) !== commitment) continue;
        const spent = await this.rpc.readContract({ address: this.manifest.contracts.nullPool, abi: nullPoolAbi, functionName: 'spentNoteNullifier', args: [fieldFromHex(noteNullifier(commitment, checkpoint.ownerNullifierKey))] });
        const hash = checkpoint.leafIndex === leafIndex && checkpoint.transactionHash ? checkpoint.transactionHash : await this.findNoteTransaction(leafIndex, history.blockNumber);
        recovered.push({ note: { ownerNullifierKey: checkpoint.ownerNullifierKey, noteSecret: checkpoint.noteSecret, amountAtomic: checkpoint.amountAtomic, policyCommitment: checkpoint.policyCommitment, bodyCommitment: body, commitment, leafIndex, transactionHash: hash }, spent });
      }
    }
    return recovered;
  }

  /** Base stealth keys plus public history recover claim notes without a hosted wallet database. */
  async recoverPrivateNotes(options: DiscoveryOptions & { checkpoints?: readonly SecretCheckpoint[] }): Promise<OwnedPrivateNote[]> {
    await this.verifyDeployment(options); const history = await this.syncHistory(options);
    const allocations = await scanEnvelopes({ envelopes: history.envelopes, distributions: history.distributions, keys: options.keys, context: this.context, source: 'chain', signal: options.signal });
    const recovered: OwnedPrivateNote[] = [];
    try {
      for (const allocation of allocations) {
        checkAbort(options); const draft = buildPrivateNote(allocation);
        if (!await this.rpc.readContract({ address: this.manifest.contracts.nullPool, abi: nullPoolAbi, functionName: 'spentClaimNullifier', args: [fieldFromHex(draft.claimNullifier)] })) continue;
        const leafIndex = history.noteLeaves.findIndex((commitment, index) => finalNoteCommitment(draft.bodyCommitment, index) === commitment);
        if (leafIndex < 0) continue; // The consumption may be newer than the confirmed history window.
        if (await this.rpc.readContract({address:this.context.poolAddress,abi:nullPoolAbi,functionName:'spentNoteNullifier',args:[fieldFromHex(noteNullifier(history.noteLeaves[leafIndex]!, draft.ownerNullifierKey))]})) continue;
        recovered.push({ ...draft, leafIndex, commitment: history.noteLeaves[leafIndex]!, transactionHash: await this.findNoteTransaction(leafIndex, history.blockNumber) });
      }
      // A funds backup also carries the claim opening. Recover it even when the
      // current browser has a different Payment ID, without trusting saved status.
      for (const checkpoint of options.checkpoints ?? []) {
        checkAbort(options);
        if (checkpoint.kind !== 'private-note' || !checkpoint.claimNullifier || checkpoint.context.chainId !== this.context.chainId || checkpoint.context.poolAddress.toLowerCase() !== this.context.poolAddress.toLowerCase()) continue;
        const body = privateNoteBody(checkpoint.ownerNullifierKey, checkpoint.amountAtomic, checkpoint.noteSecret);
        if (body !== checkpoint.bodyCommitment) continue;
        for (let leafIndex = 0; leafIndex < history.noteLeaves.length; leafIndex++) {
          const commitment = history.noteLeaves[leafIndex]!;
          if (finalNoteCommitment(body, leafIndex) !== commitment || recovered.some(note => note.commitment === commitment)) continue;
          if (await this.rpc.readContract({ address: this.context.poolAddress, abi: nullPoolAbi, functionName: 'spentNoteNullifier', args: [fieldFromHex(noteNullifier(commitment, checkpoint.ownerNullifierKey))] })) continue;
          recovered.push({ ownerNullifierKey: checkpoint.ownerNullifierKey, noteSecret: checkpoint.noteSecret, amountAtomic: checkpoint.amountAtomic, claimNullifier: checkpoint.claimNullifier, bodyCommitment: body, commitment, leafIndex, transactionHash: await this.findNoteTransaction(leafIndex, history.blockNumber) });
        }
      }
      return recovered;
    } finally { for (const allocation of allocations) allocation.stealthPrivateKey.fill(0); }
  }

  private async findNoteTransaction(index: number, toBlock: bigint): Promise<Hex> {
    // Note index is already public, but scan a broad history range rather than request a private entitlement filter.
    for (let fromBlock = BigInt(this.manifest.deploymentBlock); fromBlock <= toBlock; fromBlock += 2_000n) {
      const end = fromBlock + 1_999n < toBlock ? fromBlock + 1_999n : toBlock;
      const logs = await this.rpc.getLogs({ address: this.manifest.contracts.nullPool, fromBlock, toBlock: end });
      for (const log of logs) {
        try {
          const event = decodeEventLog({ abi: nullPoolAbi, data: log.data, topics: log.topics });
          if (event.eventName === 'NoteInserted' && Number(event.args.noteIndex) === index && log.transactionHash) return log.transactionHash;
        } catch { /* ignore unrelated event signatures */ }
      }
    }
    throw new NullError('NULL_HISTORY_INCOMPLETE', 'The note transaction was not found in public history.');
  }

  async prepareShield(options: ShieldOptions): Promise<PreparedOperation> {
    if (options.acknowledgePublicDeposit !== true) throw new NullError('NULL_PRIVACY_BOUNDARY', 'Acknowledge the public deposit before adding funds.');
    if (!this.manifest.security.withdrawalsImplemented) throw new NullError('NULL_WITHDRAWAL_UNAVAILABLE', 'New deposits are disabled until a withdrawal-capable pool is deployed.');
    await this.verifyDeployment(options);
    if (!await this.rpc.readContract({ address: this.manifest.contracts.nullAuthRegistry, abi: nullAuthRegistryAbi, functionName: 'registered', args: [fieldFromHex(options.policyCommitment)] })) throw new NullError('NULL_POLICY_UNREGISTERED', 'Register the business authorization policy before funding the treasury.');
    const ownerNullifierKey = newField('null.v1.treasury-owner'); const noteSecret = newField('null.v1.treasury-secret');
    const built = buildShieldWitness({ context: this.context, amountAtomic: options.amountAtomic, policyCommitment: options.policyCommitment, ownerNullifierKey, noteSecret });
    const recovery: SecretCheckpoint = { kind: 'treasury', phase: 'prepared', context: this.context, bodyCommitment: built.bodyCommitment, amountAtomic: options.amountAtomic, ownerNullifierKey, noteSecret, policyCommitment: options.policyCommitment };
    return this.proveAndPrepare('shield', built, recovery, options);
  }

  async prepareDistribution(options: DistributionOptions): Promise<PreparedOperation> {
    await this.verifyDeployment(options); const history = await this.syncHistory(options);
    const policy = authPolicyCommitment(options.authPolicy); const policyIndex = history.policyLeaves.indexOf(policy);
    if (policyIndex < 0) throw new NullError('NULL_POLICY_UNREGISTERED', 'The authorization policy is not present in confirmed chain history.');
    const noteTree = new IncrementalMerkleTree(20, history.noteLeaves);
    const treasuryInputs = [];
    for (const note of options.treasuryNotes) {
      if (note.policyCommitment !== policy || treasuryNoteBody(note.ownerNullifierKey, policy, note.amountAtomic, note.noteSecret) !== note.bodyCommitment || finalNoteCommitment(note.bodyCommitment, note.leafIndex) !== note.commitment || history.noteLeaves[note.leafIndex] !== note.commitment) throw new NullError('NULL_NOTE_INVALID', 'A treasury note does not match its confirmed commitment.');
      if (await this.rpc.readContract({ address: this.manifest.contracts.nullPool, abi: nullPoolAbi, functionName: 'spentNoteNullifier', args: [fieldFromHex(noteNullifier(note.commitment, note.ownerNullifierKey))] })) throw new NullError('NULL_NULLIFIER_SPENT', 'A selected treasury note is already consumed.');
      treasuryInputs.push({ ownerNullifierKey: note.ownerNullifierKey, noteSecret: note.noteSecret, amountAtomic: note.amountAtomic, path: noteTree.getPath(note.leafIndex) });
    }
    const base = { compiled: options.compiled, context: this.context, treasuryInputs, authPolicy: options.authPolicy,
      policyPath: new IncrementalMerkleTree(20, history.policyLeaves).getPath(policyIndex), changeOwnerNullifierKey: newField('null.v1.change-owner'),
      changeNoteSecret: newField('null.v1.change-secret'), nonce: newField('null.v1.distribution-nonce'), validUntil: await this.deadline(options.validForSeconds),
    };
    const intent = prepareDistributionIntent(base); progress(options, 'authorization'); checkAbort(options);
    const signerSignature = await options.authorize({ digest: intent.digest, publicInputs: [...intent.publicInputs], context: this.context, commitment: options.compiled.commitment, envelopeRoot: options.compiled.envelopeRoot });
    checkAbort(options);
    const built = buildCreateDistributionWitness({ ...base, signerSignature });
    const recovery: SecretCheckpoint = { kind: 'treasury', phase: 'prepared', context: this.context, bodyCommitment: built.changeBodyCommitment,
      ownerNullifierKey: base.changeOwnerNullifierKey, noteSecret: base.changeNoteSecret, amountAtomic: built.changeAmountAtomic, policyCommitment: policy };
    return this.proveAndPrepare('create_distribution', built, recovery, options, options.compiled.envelopes.map(({ ephemeralPubKey, viewTag, ciphertext }) => ({ ephemeralPubKey, viewTag, ciphertext })));
  }

  async prepareClaim(options: ClaimOptions): Promise<PreparedOperation> {
    await this.verifyDeployment(options); const history = await this.syncHistory(options);
    if (options.allocation.context.chainId !== this.context.chainId || options.allocation.context.poolAddress.toLowerCase() !== this.context.poolAddress.toLowerCase()) throw new NullError('NULL_CONTEXT_MISMATCH', 'This allocation belongs to a different pool.');
    const index = history.distributionLeaves.indexOf(options.allocation.distributionCommitment);
    if (index < 0) throw new NullError('NULL_DISTRIBUTION_UNCONFIRMED', 'The distribution is not present in confirmed chain history.');
    if (await this.rpc.readContract({ address: this.manifest.contracts.nullPool, abi: nullPoolAbi, functionName: 'spentClaimNullifier', args: [fieldFromHex(options.allocation.id)] })) throw new NullError('NULL_NULLIFIER_SPENT', 'This allocation was already consumed.');
    const built = buildClaimWitness({ allocation: { ...options.allocation, confirmed: true, source: 'chain' }, distributionPath: new IncrementalMerkleTree(20, history.distributionLeaves).getPath(index), nonce: newField('null.v1.claim-nonce'), validUntil: await this.deadline(options.validForSeconds) });
    const recovery: SecretCheckpoint = { kind: 'private-note', phase: 'prepared', context: this.context, ...built.note };
    return this.proveAndPrepare('claim', built, recovery, options);
  }

  async prepareWithdrawal(options: WithdrawalOptions): Promise<PreparedOperation> {
    if (!this.manifest.security.withdrawalsImplemented) throw new NullError('NULL_WITHDRAWAL_UNAVAILABLE', 'This pool has no withdrawal verifier.');
    if (options.acknowledgePublicWithdrawal !== true) throw new NullError('NULL_PRIVACY_BOUNDARY', 'Acknowledge the public withdrawal destination and amount.');
    if (options.amountAtomic !== undefined && options.amountAtomic !== options.note.amountAtomic) return this.preparePartialWithdrawal(options);
    await this.verifyDeployment(options); const history = await this.syncHistory(options);
    const note = options.note;
    const treasury = 'policyCommitment' in note;
    if (treasury && (!options.authPolicy || !options.authorize || authPolicyCommitment(options.authPolicy) !== note.policyCommitment)) throw new NullError('NULL_PRIVY_AUTH_FAILED', 'Treasury withdrawals require organization approval.');
    const body = treasury ? treasuryNoteBody(note.ownerNullifierKey, note.policyCommitment, note.amountAtomic, note.noteSecret) : privateNoteBody(note.ownerNullifierKey, note.amountAtomic, note.noteSecret);
    if (body !== note.bodyCommitment || finalNoteCommitment(body, note.leafIndex) !== note.commitment || history.noteLeaves[note.leafIndex] !== note.commitment) throw new NullError('NULL_NOTE_INVALID', 'Restore this note from confirmed history before withdrawing.');
    const authTree = new IncrementalMerkleTree(20, history.policyLeaves);
    const policyIndex = treasury ? history.policyLeaves.indexOf(note.policyCommitment) : -1;
    if (treasury && policyIndex < 0) throw new NullError('NULL_POLICY_UNREGISTERED', 'The organization policy is missing from confirmed history.');
    const base = { context:this.context, note:{...note,path:new IncrementalMerkleTree(20,history.noteLeaves).getPath(note.leafIndex)}, recipient:options.recipient, authRoot:authTree.root,
      ...(treasury ? {authPolicy:options.authPolicy!,policyPath:authTree.getPath(policyIndex)} : {}), nonce:newField('null.v1.withdraw-nonce'), validUntil:await this.deadline(options.validForSeconds) };
    const intent = prepareWithdrawalIntent(base);
    await this.preflight({chainId:this.manifest.chainId,pool:this.context.poolAddress,method:'withdraw',proof:'0x',publicInputs:intent.publicInputs});
    let signerSignature: Hex | undefined;
    if (treasury) { progress(options,'authorization'); checkAbort(options); signerSignature = await options.authorize!({digest:intent.digest,publicInputs:intent.publicInputs,context:this.context,recipient:options.recipient,amountAtomic:note.amountAtomic}); }
    checkAbort(options);
    const built = buildWithdrawalWitness({...base,signerSignature});
    const recovery: SecretCheckpoint = {...note,kind:treasury ? 'treasury' : 'private-note',phase:'confirmed',context:this.context};
    return this.proveAndPrepare('withdraw',built,recovery,options);
  }

  private async preparePartialWithdrawal(options: WithdrawalOptions): Promise<PreparedOperation> {
    if (!this.manifest.security.partialWithdrawalsImplemented) throw new NullError('NULL_PARTIAL_WITHDRAWAL_UNAVAILABLE', 'This pool supports full-note withdrawals only. Partial withdrawals require a separately deployed v0.3 pool.');
    if ('policyCommitment' in options.note) throw new NullError('NULL_METHOD_REJECTED', 'Partial withdrawals currently support recipient notes only.');
    await this.verifyDeployment(options); const history = await this.syncHistory(options);
    const note = options.note;
    if (history.noteLeaves[note.leafIndex] !== note.commitment) throw new NullError('NULL_NOTE_INVALID', 'Restore the note from confirmed history.');
    const changeOwnerNullifierKey = newField('null.v3.change-owner');
    const changeNoteSecret = newField('null.v3.change-secret');
    const built = buildPartialWithdrawalWitness({ context: this.context,
      note: { ...note, path: new IncrementalMerkleTree(20, history.noteLeaves).getPath(note.leafIndex) },
      recipient: options.recipient, authRoot: new IncrementalMerkleTree(20, history.policyLeaves).root,
      amountAtomic: options.amountAtomic!, changeOwnerNullifierKey, changeNoteSecret,
      nonce: newField('null.v3.partial-withdraw-nonce'), validUntil: await this.deadline(options.validForSeconds),
    });
    const recovery: SecretCheckpoint = { kind: 'private-note', phase: 'prepared', context: this.context,
      bodyCommitment: built.changeBodyCommitment, amountAtomic: built.changeAmountAtomic,
      ownerNullifierKey: changeOwnerNullifierKey, noteSecret: changeNoteSecret, claimNullifier: note.claimNullifier,
    };
    return this.proveAndPrepare('withdraw_partial', built, recovery, options);
  }

  private async deadline(seconds = 3_600): Promise<bigint> {
    if (!Number.isInteger(seconds) || seconds < 60 || seconds > 86_400) throw new NullError('NULL_INTENT_INVALID', 'Choose a proof deadline between one minute and one day.');
    return (await this.rpc.getBlock()).timestamp + BigInt(seconds);
  }
  private async proveAndPrepare(kind: CircuitKind, built: PreparedWitness, recovery: SecretCheckpoint, options: OperationOptions, envelopes?: PublicOperation['envelopes']): Promise<PreparedOperation> {
    progress(options, 'saving-recovery'); checkAbort(options);
    await this.options.persistLocalSecret(structuredClone(recovery));
    const proof = await proveInWorker({ kind, artifact: this.manifest.build.circuitArtifacts[kind]!, witness: built.witness as ProofRequest['witness'], expectedPublicInputs: built.publicInputs }, { signal: options.signal, onProgress: stage => progress(options, stage) });
    const operation: PublicOperation = { chainId: this.manifest.chainId, pool: this.manifest.contracts.nullPool, method: kind === 'create_distribution' ? 'createDistribution' : kind === 'withdraw_partial' ? 'withdrawPartial' : kind, proof: proof.proof, publicInputs: proof.publicInputs, ...(envelopes ? { envelopes } : {}) };
    const prepared: PreparedOperation = { publicOperation: structuredClone(operation), transaction: { chainId: operation.chainId, to: operation.pool, data: encodePublicOperation(operation), value: '0x0' }, recovery: structuredClone(recovery), createdAt: Date.now() };
    this.prepared.set(prepared, { operation: structuredClone(operation), recovery: structuredClone(recovery) });
    return prepared;
  }

  /** Broadcast only a locally prepared proof, then verify its actual confirmed effects. */
  async submit(prepared: PreparedOperation, transport: BroadcastTransport, options: OperationOptions = {}): Promise<ConfirmedOperation> {
    const stored = this.prepared.get(prepared);
    if (!stored || this.completed.has(prepared) || this.submitting.has(prepared)) throw new NullError('NULL_OPERATION_INVALID', 'This operation is unavailable or already being submitted.');
    if (this.uncertain.has(prepared)) throw new SubmissionUncertainError(stored.operation);
    this.submitting.add(prepared);
    const { operation, recovery } = stored;
    let hash: Hex | undefined;
    let confirmedRevert = false;
    try {
      await this.verifyDeployment(options); await this.preflight(operation);
      if (operation.method === 'shield' && transport.mode !== 'wallet') throw new NullError('NULL_METHOD_REJECTED', 'Shielding requires the funding wallet.');
      const data = encodePublicOperation(operation);
      const account = transport.mode === 'wallet' ? await this.walletAccount(transport.wallet) : undefined;
      if (operation.method === 'shield' && transport.mode === 'wallet' && account) await this.ensureAllowance(transport.wallet, account, BigInt(operation.publicInputs[3]!), options);
      progress(options, 'simulating'); checkAbort(options);
      await this.rpc.call({ ...(account ? { account } : {}), to: operation.pool, data, value: 0n });
      progress(options, 'submitting'); checkAbort(options);
      if (transport.mode === 'wallet') {
        const gas = (await this.rpc.estimateGas({ account: account!, to: operation.pool, data, value: 0n })) * 120n / 100n;
        if (gas > this.options.maxGas!) throw new NullError('NULL_GAS_LIMIT', 'The estimated gas exceeds the configured transaction limit.');
        try { hash = await transport.wallet.sendTransaction({ account: transport.wallet.account ?? account!, chain: this.chain, to: operation.pool, data, value: 0n, gas }); }
        catch (error) {
          if (walletRequestRejected(error)) throw new NullError('NULL_WALLET_REJECTED', 'The wallet request was declined.');
          throw new SubmissionUncertainError(operation);
        }
      } else if (transport.mode === 'sponsored') {
        // The host's authenticated sponsor receives public proof data only. Once
        // dispatched, a transport error is uncertain; never silently self-broadcast.
        try { hash = await transport.send(structuredClone(operation)); fromHex(hash, 32); }
        catch { throw new SubmissionUncertainError(operation); }
      } else hash = await this.relay(operation, transport.url);
      submitted(options, hash, operation.method); progress(options, 'confirming');
      let receipt: TransactionReceipt;
      try { receipt = await this.rpc.waitForTransactionReceipt({ hash, confirmations: this.options.confirmations, timeout: this.options.receiptTimeoutMs }); }
      catch { throw new SubmissionUncertainError(operation, hash); }
      if ((await this.rpc.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash) throw new SubmissionUncertainError(operation, receipt.transactionHash);
      if (receipt.status !== 'success') {
        confirmedRevert = true;
        throw new NullError('NULL_TRANSACTION_REVERTED', 'The transaction reverted. No successful protocol operation was confirmed.');
      }
      const transaction = await this.rpc.getTransaction({ hash: receipt.transactionHash });
      if (!matchesSubmittedCall(transaction, operation.pool, data)) throw new NullError('NULL_TRANSACTION_MISMATCH', 'The submitted transaction does not match the authorized proof.');
      const result = await this.confirmEffects(operation, recovery, receipt);
      result.transaction = { hash: transaction.hash, to: transaction.to, input: transaction.input, value: transaction.value };
      this.completed.add(prepared); progress(options, 'confirmed'); return result;
    } catch (error) {
      if (hash && !confirmedRevert && !(error instanceof SubmissionUncertainError)) {
        this.uncertain.add(prepared);
        throw new SubmissionUncertainError(operation, hash);
      }
      if (error instanceof SubmissionUncertainError) this.uncertain.add(prepared);
      throw error;
    } finally { this.submitting.delete(prepared); }
  }

  /** Read-only reconciliation, followed only by encrypted local checkpoint repair when confirmed. */
  async reconcile(prepared: PreparedOperation, transactionHash?: Hex, options: OperationOptions = {}): Promise<ReconciliationResult> {
    const stored = this.prepared.get(prepared);
    if (!stored) throw new NullError('NULL_OPERATION_INVALID', 'Reconciliation requires the original locally prepared operation.');
    await this.verifyDeployment(options);
    let hash = transactionHash;
    if (hash) fromHex(hash, 32);
    if (!hash) {
      const history = await this.syncHistory(options);
      const operation = stored.operation;
      for (let fromBlock = BigInt(this.manifest.deploymentBlock); !hash && fromBlock <= history.blockNumber; fromBlock += 2_000n) {
        checkAbort(options);
        const toBlock = fromBlock + 1_999n < history.blockNumber ? fromBlock + 1_999n : history.blockNumber;
        const logs = await this.rpc.getLogs({ address: operation.pool, fromBlock, toBlock });
        for (const log of logs) {
          if (log.removed || !log.transactionHash) continue;
          let event: { eventName: string; args: Record<string, unknown> };
          try { event = decodeEventLog({ abi: nullPoolAbi, data: log.data, topics: log.topics }) as unknown as typeof event; } catch { continue; }
          const claimMatch = operation.method === 'claim' && event.eventName === 'AllocationConsumed' && BigInt(String(event.args.claimNullifier)) === BigInt(operation.publicInputs[4]!);
          const distributionMatch = operation.method === 'createDistribution' && event.eventName === 'DistributionInserted' && BigInt(String(event.args.distributionCommitment)) === BigInt(operation.publicInputs[7]!);
          const shieldMatch = operation.method === 'shield' && event.eventName === 'Shielded' && finalNoteCommitment(stored.recovery.bodyCommitment, Number(event.args.noteIndex)) === fieldHex(BigInt(String(event.args.noteCommitment)));
          const withdrawalMatch = (operation.method === 'withdraw' || operation.method === 'withdrawPartial') && event.eventName === 'Withdrawn' && BigInt(String(event.args.noteNullifier)) === BigInt(operation.publicInputs[5]!);
          if (claimMatch || distributionMatch || shieldMatch || withdrawalMatch) { hash = log.transactionHash; break; }
        }
      }
      if (!hash) return { status: 'not-observed', explanation: 'No matching operation is present in confirmed history. The original request may still be pending; this is not evidence of failure.' };
    }
    let receipt: TransactionReceipt;
    try { receipt = await this.rpc.getTransactionReceipt({ hash }); }
    catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return { status: 'pending', transactionHash: hash };
      throw new NullError('NULL_RPC_UNAVAILABLE', 'The transaction receipt could not be checked. Try another RPC provider.');
    }
    const transaction = await this.rpc.getTransaction({ hash: receipt.transactionHash });
    if (!matchesSubmittedCall(transaction, stored.operation.pool, encodePublicOperation(stored.operation))) throw new NullError('NULL_TRANSACTION_MISMATCH', 'This transaction does not match the prepared operation.');
    const latest = await this.rpc.getBlockNumber();
    if (latest - receipt.blockNumber + 1n < BigInt(this.options.confirmations!) || (await this.rpc.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash) return { status: 'pending', transactionHash: receipt.transactionHash };
    if (receipt.status === 'reverted') { this.uncertain.delete(prepared); return { status: 'reverted', transactionHash: receipt.transactionHash, receipt }; }
    const result = await this.confirmEffects(stored.operation, stored.recovery, receipt);
    result.transaction = { hash: transaction.hash, to: transaction.to, input: transaction.input, value: transaction.value };
    this.completed.add(prepared); this.uncertain.delete(prepared); progress(options, 'confirmed');
    return { status: 'confirmed', result };
  }

  private async preflight(operation: PublicOperation): Promise<void> {
    const pool = this.manifest.contracts.nullPool;
    if (operation.method !== 'shield' && BigInt(operation.publicInputs.at(-1)!) <= (await this.rpc.getBlock()).timestamp) throw new NullError('NULL_INTENT_EXPIRED', 'The proof deadline expired. Prepare a new operation.');
    if (operation.method === 'withdraw' || operation.method === 'withdrawPartial') {
      if (operation.method === 'withdrawPartial' && !this.manifest.security.partialWithdrawalsImplemented) throw new NullError('NULL_PARTIAL_WITHDRAWAL_UNAVAILABLE', 'Partial withdrawals are not deployed.');
      if (!this.manifest.security.withdrawalsImplemented) throw new NullError('NULL_WITHDRAWAL_UNAVAILABLE', 'Withdrawals are not deployed.');
      if (!await this.rpc.readContract({address:pool,abi:nullPoolAbi,functionName:'isKnownNoteRoot',args:[BigInt(operation.publicInputs[3]!)]}) || !await this.rpc.readContract({address:this.manifest.contracts.nullAuthRegistry,abi:nullAuthRegistryAbi,functionName:'isKnownAuthRoot',args:[BigInt(operation.publicInputs[4]!)]})) throw new NullError('NULL_ROOT_STALE','Refresh note history before withdrawing.');
      if (await this.rpc.readContract({address:pool,abi:nullPoolAbi,functionName:'spentNoteNullifier',args:[BigInt(operation.publicInputs[5]!)]})) throw new NullError('NULL_NULLIFIER_SPENT','This note was already spent. Restore your balance.');
    }
    if (operation.method === 'claim') {
      if (!await this.rpc.readContract({ address: pool, abi: nullPoolAbi, functionName: 'isKnownDistributionRoot', args: [BigInt(operation.publicInputs[3]!)] })) throw new NullError('NULL_ROOT_STALE', 'Refresh distribution history and create a new proof.');
      if (await this.rpc.readContract({ address: pool, abi: nullPoolAbi, functionName: 'spentClaimNullifier', args: [BigInt(operation.publicInputs[4]!)] })) throw new NullError('NULL_NULLIFIER_SPENT', 'This allocation is already consumed.');
    }
    if (operation.method === 'createDistribution') {
      if (!await this.rpc.readContract({ address: pool, abi: nullPoolAbi, functionName: 'isKnownNoteRoot', args: [BigInt(operation.publicInputs[3]!)] }) || !await this.rpc.readContract({ address: this.manifest.contracts.nullAuthRegistry, abi: nullAuthRegistryAbi, functionName: 'isKnownAuthRoot', args: [BigInt(operation.publicInputs[4]!)] })) throw new NullError('NULL_ROOT_STALE', 'Refresh treasury and authorization history before proving again.');
      for (const index of [5, 6]) if (await this.rpc.readContract({ address: pool, abi: nullPoolAbi, functionName: 'spentNoteNullifier', args: [BigInt(operation.publicInputs[index]!)] })) throw new NullError('NULL_NULLIFIER_SPENT', 'A treasury input is already consumed.');
    }
  }
  private async walletAccount(wallet: WalletClient): Promise<Address> {
    if (await wallet.getChainId() !== this.manifest.chainId) throw new NullError('NULL_CONTEXT_MISMATCH', 'Switch the wallet to the deployment chain.');
    const address = wallet.account?.address ?? (await wallet.getAddresses())[0];
    if (!address) throw new NullError('NULL_WALLET_UNAVAILABLE', 'Connect a wallet before broadcasting.');
    return address;
  }
  private async ensureAllowance(wallet: WalletClient, account: Address, amount: bigint, options: OperationOptions): Promise<void> {
    const [balance, allowance] = await Promise.all([
      this.rpc.readContract({ address: this.manifest.asset.address, abi: tokenAbi, functionName: 'balanceOf', args: [account] }),
      this.rpc.readContract({ address: this.manifest.asset.address, abi: tokenAbi, functionName: 'allowance', args: [account, this.manifest.contracts.nullPool] }),
    ]);
    if (balance < amount) throw new NullError('NULL_BALANCE_INSUFFICIENT', 'The funding wallet does not hold enough of the configured asset.');
    if (allowance >= amount) return;
    progress(options, 'approval');
    // Reset nonzero approvals first for USDC-compatible tokens which require this pattern.
    for (const value of allowance > 0n ? [0n, amount] : [amount]) {
      checkAbort(options);
      const data = encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [this.manifest.contracts.nullPool, value] });
      const simulation = await this.rpc.call({ account, to: this.manifest.asset.address, data });
      if (simulation.data && simulation.data !== '0x' && BigInt(simulation.data) !== 1n) throw new NullError('NULL_APPROVAL_FAILED', 'The token rejected its allowance update.');
      const hash = await wallet.sendTransaction({ account: wallet.account ?? account, chain: this.chain, to: this.manifest.asset.address, data, value: 0n });
      submitted(options, hash, 'approval');
      const receipt = await this.rpc.waitForTransactionReceipt({ hash, confirmations: this.options.confirmations, timeout: this.options.receiptTimeoutMs });
      if (receipt.status !== 'success') throw new NullError('NULL_APPROVAL_FAILED', 'The token allowance transaction failed.');
    }
    if (await this.rpc.readContract({ address: this.manifest.asset.address, abi: tokenAbi, functionName: 'allowance', args: [account, this.manifest.contracts.nullPool] }) < amount) throw new NullError('NULL_APPROVAL_FAILED', 'The required token allowance was not confirmed.');
  }
  private async relay(operation: PublicOperation, url: string): Promise<Hex> {
    if (operation.method === 'shield') throw new NullError('NULL_METHOD_REJECTED', 'Shielding requires the funding wallet.');
    try {
      const response = await fetch(secureUrl(url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation), credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30_000) });
      const result = await response.json() as { transactionHash?: unknown; status?: unknown; code?: unknown };
      if (!response.ok) {
        if (response.status >= 500) throw new SubmissionUncertainError(operation);
        throw new NullError('NULL_RELAY_REJECTED', 'The relayer rejected this public payload. It remains available for self-broadcast.');
      }
      if (result.status !== 'submitted' || typeof result.transactionHash !== 'string') throw new SubmissionUncertainError(operation);
      fromHex(result.transactionHash, 32); return result.transactionHash as Hex;
    } catch (error) { if (error instanceof NullError) throw error; throw new SubmissionUncertainError(operation); }
  }
  private async confirmEffects(operation: PublicOperation, recovery: SecretCheckpoint, receipt: TransactionReceipt): Promise<ConfirmedOperation> {
    const events: { eventName: string; args: Record<string, unknown> }[] = [];
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== operation.pool.toLowerCase()) continue;
      try { events.push(decodeEventLog({ abi: nullPoolAbi, data: log.data, topics: log.topics }) as unknown as typeof events[number]); } catch { /* unrelated pool event */ }
    }
    if (operation.method === 'withdraw' || operation.method === 'withdrawPartial') {
      const nullifier = operation.publicInputs[5]!, recipient = `0x${BigInt(operation.publicInputs[6]!).toString(16).padStart(40,'0')}` as Address, amountAtomic = BigInt(operation.publicInputs[7]!);
      if (!events.some(event => event.eventName === 'Withdrawn' && BigInt(String(event.args.noteNullifier)) === BigInt(nullifier) && String(event.args.recipient).toLowerCase() === recipient.toLowerCase() && BigInt(String(event.args.amount)) === amountAtomic) || !await this.rpc.readContract({address:operation.pool,abi:nullPoolAbi,functionName:'spentNoteNullifier',args:[BigInt(nullifier)]})) throw new NullError('NULL_TRANSACTION_MISMATCH','The withdrawal was not confirmed.');
      if (operation.method === 'withdraw') {
      const note = { ...recovery, commitment:recovery.commitment!,leafIndex:recovery.leafIndex!,transactionHash:recovery.transactionHash! } as OwnedPrivateNote | OwnedTreasuryNote;
      return {transactionHash:receipt.transactionHash,receipt,note,localRecoverySaved:true,withdrawal:{recipient,amountAtomic,nullifier}};
      }
    }
    const noteEvent = events.find(event => event.eventName === 'NoteInserted' && finalNoteCommitment(recovery.bodyCommitment, Number(event.args.noteIndex)) === fieldHex(BigInt(String(event.args.noteCommitment))));
    if (!noteEvent) throw new NullError('NULL_TRANSACTION_MISMATCH', 'The confirmed transaction did not insert the expected note.');
    if (Number(noteEvent.args.noteType) !== (operation.method === 'claim' || operation.method === 'withdrawPartial' ? 1 : 0)) throw new NullError('NULL_TRANSACTION_MISMATCH', 'The inserted note has the wrong protocol type.');
    const leafIndex = Number(noteEvent.args.noteIndex); const commitment = fieldHex(BigInt(String(noteEvent.args.noteCommitment)));
    if (operation.method === 'claim') {
      const consumed = events.find(event => event.eventName === 'AllocationConsumed' && BigInt(String(event.args.claimNullifier)) === BigInt(operation.publicInputs[4]!) && Number(event.args.noteIndex) === leafIndex);
      if (!consumed || !await this.rpc.readContract({ address: operation.pool, abi: nullPoolAbi, functionName: 'spentClaimNullifier', args: [BigInt(operation.publicInputs[4]!)] })) throw new NullError('NULL_TRANSACTION_MISMATCH', 'The claim nullifier was not confirmed spent.');
    }
    if (operation.method === 'createDistribution') {
      if (!events.some(event => event.eventName === 'DistributionInserted' && BigInt(String(event.args.distributionCommitment)) === BigInt(operation.publicInputs[7]!))) throw new NullError('NULL_TRANSACTION_MISMATCH', 'The expected distribution was not inserted.');
      for (const index of [5, 6]) if (!await this.rpc.readContract({ address: operation.pool, abi: nullPoolAbi, functionName: 'spentNoteNullifier', args: [BigInt(operation.publicInputs[index]!)] })) throw new NullError('NULL_TRANSACTION_MISMATCH', 'A treasury nullifier was not confirmed spent.');
    }
    if (operation.method === 'shield' && !events.some(event => event.eventName === 'Shielded' && BigInt(String(event.args.amount)) === recovery.amountAtomic && Number(event.args.noteIndex) === leafIndex)) throw new NullError('NULL_TRANSACTION_MISMATCH', 'The expected deposit was not confirmed.');
    const confirmed: SecretCheckpoint = { ...recovery, phase: 'confirmed', commitment, leafIndex, transactionHash: receipt.transactionHash };
    let localRecoverySaved = true;
    try { await this.options.persistLocalSecret(structuredClone(confirmed)); } catch { localRecoverySaved = false; }
    const note = { ownerNullifierKey: recovery.ownerNullifierKey, noteSecret: recovery.noteSecret, amountAtomic: recovery.amountAtomic, bodyCommitment: recovery.bodyCommitment, commitment, leafIndex, transactionHash: receipt.transactionHash,
      ...(recovery.kind === 'treasury' ? { policyCommitment: recovery.policyCommitment! } : { claimNullifier: recovery.claimNullifier! }) } as OwnedTreasuryNote | OwnedPrivateNote;
    return { transactionHash: receipt.transactionHash, receipt, note, localRecoverySaved, ...(operation.method === 'createDistribution' ? { distributionCommitment: operation.publicInputs[7]! } : {}), ...(operation.method === 'withdrawPartial' ? { withdrawal: { recipient: ('0x' + BigInt(operation.publicInputs[6]!).toString(16).padStart(40, '0')) as Address, amountAtomic: BigInt(operation.publicInputs[7]!), nullifier: operation.publicInputs[5]! } } : {}) };
  }
}
