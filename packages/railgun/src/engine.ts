/// <reference path="./types/snarkjs.d.ts" />
import "./globals";
// Railgun engine wrapper for SQL on Ethereum mainnet. This module loads the full Railgun SDK,
// so apps should import it lazily (dynamic import) after the user opens a fund screen.
import {
  ArtifactStore, startRailgunEngine, stopRailgunEngine, loadProvider, getProver, setLoggers,
  createRailgunWallet, loadWalletByID, getWalletMnemonic, validateRailgunAddress, walletForID,
  balanceForERC20Token, refreshBalances, setOnBalanceUpdateCallback, setOnUTXOMerkletreeScanCallback,
  setOnTXIDMerkletreeScanCallback,
  rescanFullUTXOMerkletreesAndWallets,
  getWalletTransactionHistory,
  unloadWalletByID,
  getShieldPrivateKeySignatureMessage, gasEstimateForShield, populateShield,
  gasEstimateForUnprovenTransfer, generateTransferProof, populateProvedTransfer,
  gasEstimateForUnprovenUnshield, generateUnshieldProof, populateProvedUnshield,
  getERC20AndNFTAmountRecipientsForUnshieldToOrigin, gasEstimateForUnprovenUnshieldToOrigin,
  generateUnshieldToOriginProof, populateProvedUnshieldToOrigin,
} from '@railgun-community/wallet';
import { EVMGasType, NETWORK_CONFIG, NetworkName, TXIDVersion, type RailgunERC20AmountRecipient, type TransactionGasDetails } from '@railgun-community/shared-models';
import { Mnemonic, keccak256, pbkdf2, randomBytes, hexlify, toUtf8Bytes } from 'ethers';
import { groth16 } from 'snarkjs';
import { assertOriginQuoteUnchanged, originQuoteFromRecipients, validateShieldTransactionHash, type OriginWithdrawalQuote } from './origin-withdrawal';
export type { OriginWithdrawalQuote } from './origin-withdrawal';
import { encodeFunctionData, parseAbi } from 'viem';
import { DEFAULT_POI_NODES, MAINNET_CHAIN_ID, RAILGUN_DEPLOYMENT_BLOCK, USDC, WALLET_SOURCE } from './network';
import { MAX_RECIPIENTS, type ResolvedRow } from './recipients';
import { scanProgress } from './scan-progress';
import { withinScanDeadline } from './scan-deadline';

const NET = NetworkName.Ethereum;
const TXID = TXIDVersion.V2_PoseidonMerkle;
const CHAIN = NETWORK_CONFIG[NET].chain;
export const RAILGUN_PROXY_ADDRESS = NETWORK_CONFIG[NET].proxyContract as `0x${string}`;

/** The user's external EVM wallet. SQL never sees its private key. */
export type EvmSender = {
  address: `0x${string}`;
  chainId: () => Promise<number>;
  signMessage: (message: string) => Promise<`0x${string}`>;
  sendTransaction: (tx: { to: `0x${string}`; data: `0x${string}`; value?: bigint; gas?: bigint }) => Promise<`0x${string}`>;
  waitForReceipt: (hash: `0x${string}`) => Promise<{ status: 'success' | 'reverted' }>;
  readAllowance: (token: `0x${string}`, owner: `0x${string}`, spender: `0x${string}`) => Promise<bigint>;
  fees: () => Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>;
};

export type EngineOptions = {
  /** LevelDOWN-compatible store: level-js in the browser, memdown in tests. */
  db: unknown;
  artifacts: { get: (path: string) => Promise<string | Uint8Array | null>; store: (dir: string, path: string, item: string | Uint8Array) => Promise<void>; exists: (path: string) => Promise<boolean> };
  rpcUrls: string[];
  poiNodeUrls?: string[];
  debug?: boolean;
  /** Skip loading the RPC provider (offline tests). */
  offline?: boolean;
  onScanProgress?: (progress: number, status?: string, phase?: 'notes' | 'proofs') => void;
};

let started = false;
let starting: Promise<void> | null = null;
const balanceListeners = new Set<() => void>();
let scanPending = false, scanIncomplete = false;
const pendingScans = new Set<string>();
const scanSettled = new Set<() => void>();
let syncQueue: Promise<void> = Promise.resolve();
const pendingRescans = new Map<string, Promise<void>>();
async function waitForScan() {
  if (!scanPending) return;
  await new Promise<void>((resolve, reject) => {
    const finish = () => { clearTimeout(timer); scanSettled.delete(finish); resolve(); };
    const timer = setTimeout(() => { scanSettled.delete(finish); reject(new Error('History synchronization is still running. Keep transfers paused and check the connection.')); }, 600_000);
    scanSettled.add(finish);
  });
}

export function startEngine(options: EngineOptions): Promise<void> {
  if (started) return Promise.resolve();
  if (starting) return starting;
  starting = (async () => {
  // SDK error payloads can contain private transaction material. Never log them.
  setLoggers(undefined, () => console.warn('Railgun reported an operation error. Check the connection status.'));
  const store = new ArtifactStore(
    async path => (await options.artifacts.get(path)) as never,
    options.artifacts.store,
    options.artifacts.exists,
  );
  await startRailgunEngine(WALLET_SOURCE, options.db as never, !!options.debug, store, false, false, options.poiNodeUrls ?? DEFAULT_POI_NODES, undefined, false);
  getProver().setSnarkJSGroth16(groth16 as never);
  setOnBalanceUpdateCallback(() => balanceListeners.forEach(fn => fn()));
  const scanUpdate = (phase: 'notes' | 'proofs', event: { chain: { id: number; type: number }; scanStatus: string; progress: number }) => {
    if (event.chain.id !== CHAIN.id || event.chain.type !== CHAIN.type) return;
    if (event.scanStatus === 'Started' || event.scanStatus === 'Updated') pendingScans.add(phase);
    else pendingScans.delete(phase);
    scanPending = pendingScans.size > 0;
    if (event.scanStatus === 'Incomplete') scanIncomplete = true;
    const normalized = scanProgress(phase, event.scanStatus, event.progress, scanPending);
    options.onScanProgress?.(normalized.progress, normalized.status, phase);
    if (!scanPending) scanSettled.forEach(finish => finish());
  };
  setOnUTXOMerkletreeScanCallback(event => scanUpdate('notes', event));
  setOnTXIDMerkletreeScanCallback(event => scanUpdate('proofs', event));
  if (!options.offline) {
    if (options.rpcUrls.length === 0) throw new Error('Add an Ethereum mainnet RPC URL.');
    await loadProvider({ chainId: MAINNET_CHAIN_ID, providers: options.rpcUrls.map((provider, i) => ({ provider, priority: i + 1, weight: options.rpcUrls.length > 1 ? 1 : 2, maxLogsPerBatch: 1, stallTimeout: 2500 })) }, NET, 15_000);
  }
  started = true;
  })().catch(async () => {
    await stopRailgunEngine().catch(() => {});
    pendingScans.clear(); scanPending = false; scanIncomplete = true; scanSettled.forEach(finish => finish());
    started = false;
    throw new Error('The Railgun connection could not start. Check the mainnet connection and try again.');
  }).finally(() => { starting = null; });
  return starting;
}

export async function stopEngine() { if (started) { await stopRailgunEngine(); started = false; } }

/** 32-byte hex key derived from the user's vault password. Railgun encrypts the wallet with it. */
export function deriveEncryptionKey(password: string, saltHex: string): string {
  if (password.length < 10) throw new RangeError('Use a vault password of at least 10 characters.');
  return pbkdf2(toUtf8Bytes(password), saltHex, 210_000, 32, 'sha256').slice(2);
}

export type VaultRecord = { walletId: string; railgunAddress: string; salt: string; createdAt: number };

/** Creates a new Railgun wallet. The mnemonic is returned once so the user can back it up. */
export async function createVault(password: string, options: { mnemonic?: string; creationBlock?: number } = {}) {
  const mnemonic = options.mnemonic?.trim() || Mnemonic.fromEntropy(randomBytes(16)).phrase;
  if (!Mnemonic.isValidMnemonic(mnemonic)) throw new RangeError('That recovery phrase is not a valid BIP-39 mnemonic.');
  const salt = hexlify(randomBytes(16));
  const key = deriveEncryptionKey(password, salt);
  const block = options.mnemonic ? RAILGUN_DEPLOYMENT_BLOCK : options.creationBlock ?? RAILGUN_DEPLOYMENT_BLOCK;
  const info = await createRailgunWallet(key, mnemonic, { [NET]: block } as never);
  const record: VaultRecord = { walletId: info.id, railgunAddress: info.railgunAddress, salt, createdAt: Date.now() };
  return { record, mnemonic: options.mnemonic ? undefined : mnemonic, key };
}

export async function unlockVault(record: VaultRecord, password: string) {
  const key = deriveEncryptionKey(password, record.salt);
  // Decrypting the stored mnemonic proves the key; loadWalletByID alone returns a cached wallet.
  try { await getWalletMnemonic(key, record.walletId); await loadWalletByID(key, record.walletId, false); }
  catch { throw new Error('Wrong vault password.'); }
  return key;
}

export const revealMnemonic = (record: VaultRecord, key: string) => getWalletMnemonic(key, record.walletId);
export const isRailgunAddress = (value: string) => validateRailgunAddress(value);

export async function vaultBalance(record: VaultRecord) {
  const wallet = walletForID(record.walletId);
  const [total, spendable] = await Promise.all([
    balanceForERC20Token(TXID, wallet, NET, USDC.address, false),
    balanceForERC20Token(TXID, wallet, NET, USDC.address, true),
  ]);
  return { total, spendable, pending: total - spendable };
}

export async function rescan(record: VaultRecord, full = false) {
  const request = `${record.walletId}:${full ? 'full' : 'incremental'}`;
  let task = pendingRescans.get(request);
  if (!task) {
    task = syncQueue.catch(() => {}).then(async () => {
      // Cached zero balances are not proof of synchronization.
      await waitForScan(); scanIncomplete = false;
      if (full) await rescanFullUTXOMerkletreesAndWallets(CHAIN, [record.walletId]);
      else await refreshBalances(CHAIN, [record.walletId]);
      await waitForScan();
      if (scanIncomplete) throw new Error('History synchronization did not finish. Check the connection and retry before transferring funds.');
    });
    // A UI deadline must not release this queue while the SDK is still busy.
    syncQueue = task;
    pendingRescans.set(request, task);
    void task.finally(() => pendingRescans.delete(request)).catch(() => {});
  }
  return withinScanDeadline(task);
}
export const onBalances = (cb: () => void) => { balanceListeners.add(cb); return () => { balanceListeners.delete(cb); }; };
/** All decrypted local history, not a capped public explorer feed. Caller must enforce vault unlock. */
export async function vaultHistory(record: VaultRecord) {
  return getWalletTransactionHistory(CHAIN, record.walletId, undefined);
}
export function unloadVault(walletId: string) { unloadWalletByID(walletId); }

async function gasDetails(sender: EvmSender, gasEstimate: bigint): Promise<TransactionGasDetails> {
  const fees = await sender.fees();
  return { evmGasType: EVMGasType.Type2, gasEstimate, ...fees };
}

async function assertMainnet(sender: EvmSender) {
  const id = await sender.chainId();
  if (id !== MAINNET_CHAIN_ID) throw new Error(`Your wallet is on chain ${id}. Switch it to Ethereum mainnet.`);
}

async function send(sender: EvmSender, tx: { to?: string | null; data: string; value?: bigint }, gas?: bigint, expected = RAILGUN_PROXY_ADDRESS) {
  if (!tx.to || tx.to.toLowerCase() !== expected.toLowerCase()) throw new Error('The transaction destination did not match the reviewed contract.');
  if ((tx.value ?? 0n) !== 0n || !/^0x[0-9a-f]+$/i.test(tx.data)) throw new Error('The transaction contents did not match a USDC operation.');
  await assertMainnet(sender);
  const hash = await sender.sendTransaction({ to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: tx.value ?? 0n, gas });
  const receipt = await sender.waitForReceipt(hash);
  if (receipt.status !== 'success') throw new Error(`Transaction ${hash} reverted.`);
  return hash;
}

export type Progress = (stage: string, detail?: number) => void;

/**
 * Moves public USDC from the user's EVM wallet into their private Railgun balance.
 * 1) approve the Railgun proxy if needed, 2) sign the shield key message, 3) send the shield tx.
 */
export async function shieldUsdc(sender: EvmSender, record: VaultRecord, amount: bigint, progress: Progress = () => {}) {
  positiveAmount(amount);
  if (!isRailgunAddress(record.railgunAddress)) throw new Error('Invalid recovery vault address.');
  await assertMainnet(sender);
  const allowance = await sender.readAllowance(USDC.address, sender.address, RAILGUN_PROXY_ADDRESS);
  if (allowance < amount) {
    progress('approve');
    const data = encodeFunctionData({ abi: parseAbi(['function approve(address spender, uint256 amount) returns (bool)']), functionName: 'approve', args: [RAILGUN_PROXY_ADDRESS, amount] });
    await send(sender, { to: USDC.address, data }, undefined, USDC.address);
  }
  progress('sign');
  const shieldKey = keccak256(await sender.signMessage(getShieldPrivateKeySignatureMessage()));
  const recipients: RailgunERC20AmountRecipient[] = [{ tokenAddress: USDC.address, amount, recipientAddress: record.railgunAddress }];
  progress('estimate');
  const { gasEstimate } = await gasEstimateForShield(TXID, NET, shieldKey, recipients, [], sender.address);
  const { transaction } = await populateShield(TXID, NET, shieldKey, recipients, [], await gasDetails(sender, gasEstimate));
  progress('submit');
  return send(sender, transaction, gasEstimate);
}

/**
 * Private payout: one Railgun transfer from the organization's 0zk balance to each recipient's
 * 0zk address. Recipients and amounts are encrypted; the public wallet only pays gas.
 */
export async function privatePayout(sender: EvmSender, record: VaultRecord, key: string, rows: ResolvedRow[], memo: string | undefined, progress: Progress = () => {}) {
  if (rows.length === 0 || rows.length > MAX_RECIPIENTS || rows.some(row => !isRailgunAddress(row.railgunAddress))) throw new Error('Check all payout recipients before continuing.');
  rows.forEach(row => positiveAmount(row.amount));
  if (memo && memo.length > 120) throw new Error('The private memo is too long.');
  const total = rows.reduce((sum, row) => sum + row.amount, 0n); positiveAmount(total);
  if ((await vaultBalance(record)).spendable < total) throw new Error('The spendable balance is lower than this payout.');
  await assertMainnet(sender);
  const recipients: RailgunERC20AmountRecipient[] = rows.map(r => ({ tokenAddress: USDC.address, amount: r.amount, recipientAddress: r.railgunAddress }));
  const original = await gasDetails(sender, 0n);
  progress('estimate');
  const { gasEstimate } = await gasEstimateForUnprovenTransfer(TXID, NET, record.walletId, key, memo, recipients, [], original, undefined, true);
  progress('prove', 0);
  await generateTransferProof(TXID, NET, record.walletId, key, false, memo, recipients, [], undefined, true, undefined, p => progress('prove', p));
  const { transaction } = await populateProvedTransfer(TXID, NET, record.walletId, false, memo, recipients, [], undefined, true, undefined, await gasDetails(sender, gasEstimate));
  progress('submit');
  return send(sender, transaction, gasEstimate);
}

/** Withdraws private USDC to any public address (a fresh wallet is best for privacy). */
export async function unshieldUsdc(sender: EvmSender, record: VaultRecord, key: string, to: `0x${string}`, amount: bigint, progress: Progress = () => {}) {
  positiveAmount(amount);
  if (!/^0x[0-9a-f]{40}$/i.test(to) || /^0x0{40}$/i.test(to)) throw new Error('Choose a valid non-zero withdrawal address.');
  if ((await vaultBalance(record)).spendable < amount) throw new Error('The spendable balance is lower than this withdrawal.');
  await assertMainnet(sender);
  const recipients: RailgunERC20AmountRecipient[] = [{ tokenAddress: USDC.address, amount, recipientAddress: to }];
  const original = await gasDetails(sender, 0n);
  progress('estimate');
  const { gasEstimate } = await gasEstimateForUnprovenUnshield(TXID, NET, record.walletId, key, recipients, [], original, undefined, true);
  progress('prove', 0);
  await generateUnshieldProof(TXID, NET, record.walletId, key, recipients, [], undefined, true, undefined, p => progress('prove', p));
  const { transaction } = await populateProvedUnshield(TXID, NET, record.walletId, recipients, [], undefined, true, undefined, await gasDetails(sender, gasEstimate));
  progress('submit');
  return send(sender, transaction, gasEstimate);
}

/** Official self-broadcast return path: no PPOI bypass and no arbitrary destination. */
export async function originWithdrawalQuote(record: VaultRecord, originalShieldTxid: string): Promise<OriginWithdrawalQuote> {
  validateShieldTransactionHash(originalShieldTxid);
  const { erc20AmountRecipients, nftAmountRecipients } = await getERC20AndNFTAmountRecipientsForUnshieldToOrigin(TXID, NET, record.walletId, originalShieldTxid);
  return originQuoteFromRecipients(originalShieldTxid, erc20AmountRecipients, nftAmountRecipients);
}

export async function unshieldToOriginUsdc(sender: EvmSender, record: VaultRecord, key: string, reviewed: OriginWithdrawalQuote, progress: Progress = () => {}) {
  await assertMainnet(sender);
  const current = await originWithdrawalQuote(record, reviewed.shieldTxid);
  assertOriginQuoteUnchanged(reviewed, current);
  const recipients: RailgunERC20AmountRecipient[] = [{ tokenAddress: USDC.address, recipientAddress: current.to, amount: current.amount }];
  progress('estimate');
  const { gasEstimate } = await gasEstimateForUnprovenUnshieldToOrigin(current.shieldTxid, TXID, NET, record.walletId, key, recipients, []);
  progress('prove', 0);
  await generateUnshieldToOriginProof(current.shieldTxid, TXID, NET, record.walletId, key, recipients, [], p => progress('prove', p));
  const { transaction } = await populateProvedUnshieldToOrigin(TXID, NET, record.walletId, recipients, [], await gasDetails(sender, gasEstimate));
  progress('submit');
  return send(sender, transaction, gasEstimate);
}

function positiveAmount(amount: bigint) {
  if (typeof amount !== 'bigint' || amount <= 0n || amount >= 2n ** 256n) throw new Error('Enter a positive USDC amount within the supported range.');
}
