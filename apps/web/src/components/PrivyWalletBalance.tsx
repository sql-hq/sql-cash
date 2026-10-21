import { useEffect, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { createPublicClient, erc20Abi, fallback, http, type Address } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { USDC } from '@silentquery/railgun';
import { config } from '../lib/config';
import deployment from '../../public/deployment.json';
import { readWalletBalances, walletAmount, type WalletBalances } from '../lib/wallet-balances';
import { short } from '../lib/format';

const isMainnet = config.network === 'mainnet';
const networkLabel = isMainnet ? 'Ethereum mainnet' : 'Ethereum Sepolia';
const client = createPublicClient({ chain: isMainnet ? mainnet : sepolia, transport: fallback((isMainnet ? config.mainnetRpcUrls : config.rpcUrls).map(url => http(url, { timeout: 8_000, retryCount: 0 }))), cacheTime: 0 });
const reader = {
  getChainId: () => client.getChainId(),
  getBlockNumber: () => client.getBlockNumber(),
  eth: (address: Address, blockNumber: bigint) => client.getBalance({ address, blockNumber }),
  usdc: (address: Address, blockNumber: bigint) => client.readContract({ address: isMainnet ? USDC.address : deployment.asset.address as Address, abi: erc20Abi, functionName: 'balanceOf', args: [address], blockNumber }),
};

export function ConnectedWalletBalance({ addresses, ready, hideBalances, onFeedback }: {
  addresses: readonly Address[]; ready: boolean; hideBalances: boolean; onFeedback: (message: string) => void;
}) {
  const [selected, setSelected] = useState<Address>();
  const address = selected && addresses.includes(selected) ? selected : addresses[0];
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{ address: Address; balances: WalletBalances; loading: boolean }>();
  const current = snapshot?.address === address ? snapshot : undefined;
  const loading = !current || current.loading;
  useEffect(() => {
    if (!address || !ready) return;
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (!active || pending || document.visibilityState === 'hidden') return;
      pending = true;
      setSnapshot(previous => ({ address, balances: previous?.address === address ? previous.balances : { eth: null, usdc: null }, loading: true }));
      const balances = await readWalletBalances(reader, address, config.targetChainId).catch(() => ({ eth: null, usdc: null }));
      pending = false;
      if (!active) return;
      setSnapshot({ address, balances, loading: false });
    };
    void refresh();
    const timer = setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [address, ready, revision]);
  const balance = (asset: keyof WalletBalances) => {
    if (hideBalances) return '••••';
    const value = current?.balances[asset];
    if (value == null) return loading ? 'Checking…' : 'Unavailable';
    return walletAmount(value, asset === 'eth' ? 18 : deployment.asset.decimals, asset === 'usdc' ? 2 : 0);
  };
  return <section className="account-wallet" aria-label="Connected wallet">
    <div className="account-wallet-heading"><h2>Connected wallet</h2>{address && ready && <button type="button" className="icon-button" aria-label="Refresh wallet balances" title="Refresh wallet balances" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} /></button>}</div>
    {!ready ? <p className="account-wallet-message" role="status">Loading your wallet…</p> : !address ? <p className="account-wallet-message">No funding wallet is connected.</p> : <>
      {addresses.length > 1 && <label className="account-wallet-selector">Wallet<select value={address} onChange={event => setSelected(event.target.value as Address)}>{addresses.map((item, index) => <option key={item} value={item}>Wallet {index + 1} · {short(item)}</option>)}</select></label>}
      <div className="account-wallet-address"><code>{address}</code><button type="button" className="icon-button" aria-label="Copy connected wallet address" title="Copy wallet address" onClick={async () => {
        try { await navigator.clipboard.writeText(address); onFeedback('Wallet address copied.'); }
        catch { onFeedback('Could not copy. Select the wallet address to copy it.'); }
      }}><Copy size={15} /></button></div>
      <dl className="account-wallet-balances" aria-label={`Wallet funds on ${networkLabel}`}><div><dt>{isMainnet ? 'ETH' : 'Sepolia ETH'}</dt><dd>{balance('eth')}</dd></div><div><dt>USDC</dt><dd>{balance('usdc')}</dd></div></dl>
      <p className="account-wallet-message">For deposits and gas · {networkLabel}</p>
      {current && !current.loading && (current.balances.eth === null || current.balances.usdc === null) && <p className="account-wallet-error" role="status">Some balances could not be loaded. Try refreshing.</p>}
    </>}
  </section>;
}
