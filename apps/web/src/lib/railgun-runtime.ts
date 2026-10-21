// Browser bootstrap for SQL's Railgun backend on Ethereum mainnet.
// The Railgun SDK is loaded lazily the first time a fund screen needs it.
import { createPublicClient, createWalletClient, custom, fallback, http, parseAbi, type EIP1193Provider } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';
import { config } from './config';
import type { VaultRecord, EvmSender } from '@silentquery/railgun/engine';
import { readVault, writeVault, validateVaultRecord, vaultContext, currentVaultSession, subscribeVaultLock } from './vault-safety';
import { requireWalletAccount } from './reown-session';
import { assertTransactionsEnabled } from './mainnet-safety';
import { beginTransaction, updateTransaction } from './mainnet-journal';

export type { VaultRecord };
type Engine = typeof import('@silentquery/railgun/engine');

export const mainnetClient = createPublicClient({ chain: mainnet, transport: fallback(config.mainnetRpcUrls.map(url => http(url))) });

/** Reads the `railgun` text record from mainnet ENS. */
export async function readEnsText(name: string, key: string) {
  try { return await mainnetClient.getEnsText({ name: normalize(name), key }); }
  catch { return null; }
}

// ---- IndexedDB key/value store for circuit artifacts (several MB each, downloaded once). ----
const DB_NAME = 'sql-railgun-artifacts';
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
async function idbOp<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode);
    const req = fn(tx.objectStore('files'));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error('Circuit storage could not be saved. Check browser storage and try again.')); };
  });
}
const artifacts = {
  get: async (path: string) => (await idbOp('readonly', s => s.get(path))) as string | Uint8Array | null ?? null,
  store: async (_dir: string, path: string, item: string | Uint8Array) => { await idbOp('readwrite', s => s.put(item, path)); },
  exists: async (path: string) => (await idbOp('readonly', s => s.count(path))) > 0,
};

let enginePromise: Promise<Engine> | null = null;
let offVaultLock: (() => void) | undefined;
export type ScanListener = (progress: number, status?: string, phase?: 'notes' | 'proofs') => void;
const scanListeners = new Set<ScanListener>();
export const onScan = (fn: ScanListener) => { scanListeners.add(fn); return () => { scanListeners.delete(fn); }; };

/** Loads the Railgun SDK, opens its IndexedDB database and connects to mainnet RPCs. */
export function loadEngine(): Promise<Engine> {
  enginePromise ??= (async () => {
    // Node globals (Buffer, process) must exist before level-js or the SDK evaluate.
    await import('@silentquery/railgun/globals');
    const [engine, { default: LevelJs }] = await Promise.all([import('@silentquery/railgun/engine'), import('level-js')]);
    await engine.startEngine({
      db: new (LevelJs as unknown as new (name: string) => unknown)('sql-railgun-engine'),
      artifacts, rpcUrls: config.mainnetRpcUrls,
      onScanProgress: (p, status, phase) => scanListeners.forEach(fn => fn(p, status, phase)),
    });
    offVaultLock?.(); offVaultLock = subscribeVaultLock(id => engine.unloadVault(id));
    return engine;
  })().catch(error => { enginePromise = null; throw error; });
  return enginePromise;
}

// ---- Vault record (wallet id, salt, 0zk address). The mnemonic itself lives encrypted inside the engine DB. ----
const VAULT_KEY = 'sql-railgun-vault';
export function storedVault(owner: string): VaultRecord | null {
  return readVault(localStorage, owner);
}
export function saveVault(owner: string, record: VaultRecord | null) {
  writeVault(localStorage, owner, record);
}
/** Legacy metadata is never silently assigned to a different wallet. */
export function legacyVault(): VaultRecord | null {
  const raw = localStorage.getItem(VAULT_KEY);
  if (!raw) return null;
  try { return validateVaultRecord(JSON.parse(raw)); }
  catch { throw new Error('The previous vault metadata is damaged. Use your recovery backup; no data has been deleted.'); }
}

const erc20 = parseAbi(['function allowance(address owner, address spender) view returns (uint256)', 'function balanceOf(address owner) view returns (uint256)']);

/** Wraps the user's connected wallet (MetaMask, WalletConnect…) as the signer for Railgun transactions. */
export function evmSender(provider: EIP1193Provider, address: `0x${string}`, owner: string): EvmSender {
  if (!currentVaultSession(owner)) throw new Error('Unlock the selected vault before requesting a transaction.');
  const wallet = createWalletClient({ account: address, chain: mainnet, transport: custom(provider) });
  const context = vaultContext(owner);
  const guard = async () => {
    assertTransactionsEnabled(config.mainnetTransactionsEnabled);
    context(); await requireWalletAccount(provider, address);
    if (Number(await provider.request({ method: 'eth_chainId' })) !== 1) throw new Error('Switch your wallet to Ethereum mainnet.');
    context();
  };
  return {
    address,
    chainId: () => wallet.getChainId(),
    signMessage: async message => { await guard(); const signature = await wallet.signMessage({ account: address, message }); await guard(); return signature; },
    sendTransaction: async tx => {
      await guard();
      const estimate = await mainnetClient.estimateGas({ account: address, to: tx.to, data: tx.data, value: tx.value ?? 0n });
      const padded = (estimate * 120n + 99n) / 100n;
      const gas = tx.gas && tx.gas > padded ? tx.gas : padded;
      const [fees, balance] = await Promise.all([mainnetClient.estimateFeesPerGas(), mainnetClient.getBalance({ address })]);
      if (gas * fees.maxFeePerGas + (tx.value ?? 0n) > balance) throw new Error('Not enough ETH for gas.');
      if (!navigator.locks) throw new Error('This browser cannot safely coordinate transactions. Use a current browser with Web Locks support.');
      return navigator.locks.request(`sql-mainnet-send:${owner}`, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('A transaction is already in progress in another tab.');
        await guard();
        const id = beginTransaction(localStorage, owner);
        let hash: `0x${string}` | undefined;
        try {
          hash = await wallet.sendTransaction({ account: address, chain: mainnet, to: tx.to, data: tx.data, value: tx.value ?? 0n, gas });
          updateTransaction(localStorage, owner, id, 'pending', hash);
          return hash;
        } catch (error) {
          const rejected = (error as { code?: number }).code === 4001 || /user rejected|denied/i.test(error instanceof Error ? error.message : '');
          updateTransaction(localStorage, owner, id, rejected && !hash ? 'cancelled' : 'uncertain', hash);
          throw error;
        }
      });
    },
    waitForReceipt: async hash => {
      try {
        const receipt = await mainnetClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 180_000 });
        updateTransaction(localStorage, owner, hash, receipt.status === 'success' ? 'confirmed' : 'reverted');
        return { status: receipt.status };
      }
      catch { throw new Error(`Transaction submitted: ${hash}. Confirmation is not known yet. Check wallet activity before sending again.`); }
    },
    readAllowance: (token, owner, spender) => mainnetClient.readContract({ address: token, abi: erc20, functionName: 'allowance', args: [owner, spender] }),
    fees: async () => { const f = await mainnetClient.estimateFeesPerGas(); return { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas }; },
  };
}

export const publicUsdcBalance = (token: `0x${string}`, owner: `0x${string}`) => mainnetClient.readContract({ address: token, abi: erc20, functionName: 'balanceOf', args: [owner] });
export const txUrl = (hash: string) => `https://etherscan.io/tx/${hash}`;
