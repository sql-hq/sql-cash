import { useState, type ReactNode } from 'react';
import { Link2, PlugZap, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import { useSession } from '../lib/session';
import { config } from '../lib/config';

export const SEPOLIA_ID = 11155111;
export const MAINNET_ID = 1;
/** Chain funds move on: Ethereum mainnet by default, Sepolia for the legacy test pool. */
export const TARGET_CHAIN_ID = config.targetChainId;
export const TARGET_CHAIN_NAME = TARGET_CHAIN_ID === MAINNET_ID ? 'Ethereum mainnet' : 'Sepolia';
export type EvmStatus = 'unavailable' | 'disconnected' | 'wrong-network' | 'ready';

export function short(address: string) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }

/** The connected external EVM wallet, preferring one already on the target chain. */
export function useEvmWallet() {
  const session = useSession();
  const wallets = session.evmWallets ?? [];
  const wallet = wallets.find(item => item.chainId === TARGET_CHAIN_ID) ?? wallets[0];
  const status: EvmStatus = !session.configured || !session.connectWallet ? 'unavailable'
    : !wallet ? 'disconnected' : wallet.chainId !== TARGET_CHAIN_ID ? 'wrong-network' : 'ready';
  return { status, wallet, connect: session.connectWallet, switchNetwork: session.switchNetwork, getProvider: session.getEvmProvider };
}

type PanelProps = {
  status: Exclude<EvmStatus, 'ready'>;
  feature: string;
  address?: string;
  chainId?: number | null;
  busy?: boolean;
  error?: string;
  onConnect?: () => void;
  onSwitch?: () => void;
};

const steps = ['Connect an EVM wallet', `Switch to ${TARGET_CHAIN_NAME}`, `Open ${'{feature}'}`];

/** Presentational gate used by the live app and the console preview. */
export function WalletGatePanel({ status, feature, address, chainId, busy, error, onConnect, onSwitch }: PanelProps) {
  const current = status === 'wrong-network' ? 1 : 0;
  return <section className="wg" aria-labelledby="wg-title">
    <div className="wg-head">
      <span className="wg-icon" aria-hidden>{status === 'wrong-network' ? <RefreshCw size={22} /> : <Wallet size={22} />}</span>
      <div>
        <p className="wg-kicker">Access locked · EVM wallet required</p>
        <h2 id="wg-title">{status === 'wrong-network' ? `Switch your wallet to ${TARGET_CHAIN_NAME}` : `Connect a wallet to open ${feature}`}</h2>
      </div>
    </div>
    <p className="wg-copy">{status === 'unavailable'
      ? 'Wallet connection is not configured in this build. Funds stay locked until an EVM wallet can be connected.'
      : status === 'wrong-network'
        ? `${address ? short(address) : 'Your wallet'} is on chain ${chainId ?? 'unknown'}. SQL runs on ${TARGET_CHAIN_NAME} (chain ${TARGET_CHAIN_ID}); switch networks to continue.`
        : 'Payments, deposits, claims and withdrawals are signed by your own EVM wallet. Signing in with email alone cannot move funds.'}</p>
    <ol className="wg-steps">
      {steps.map((label, i) => <li key={label} className={i < current ? 'is-done' : i === current ? 'is-current' : ''}>
        <span>{String(i + 1).padStart(2, '0')}</span>{label.replace('{feature}', feature)}
      </li>)}
    </ol>
    <div className="button-row">
      {status === 'wrong-network'
        ? <button type="button" className="button button-primary" onClick={onSwitch} disabled={busy}><RefreshCw size={16} />{busy ? 'Switching…' : `Switch to ${TARGET_CHAIN_NAME}`}</button>
        : <button type="button" className="button button-primary" onClick={onConnect} disabled={busy || status === 'unavailable'}><PlugZap size={16} />Connect wallet</button>}
      {status === 'wrong-network' && <button type="button" className="button button-secondary" onClick={onConnect}><Link2 size={16} />Use another wallet</button>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <p className="wg-foot"><ShieldCheck size={14} /> MetaMask, Coinbase Wallet, Rabby, Rainbow or WalletConnect. SQL never asks for your seed phrase.</p>
  </section>;
}

/** Blocks fund screens until an external EVM wallet on the target chain is connected. */
export function WalletGate({ feature, children }: { feature: string; children: ReactNode }) {
  const { status, wallet, connect, switchNetwork } = useEvmWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (status === 'ready') return children;
  const doSwitch = async () => {
    if (!wallet || !switchNetwork) return;
    setBusy(true); setError('');
    try { await switchNetwork(wallet.address); }
    catch { setError(`The wallet did not switch networks. Approve the request in your wallet, or switch to ${TARGET_CHAIN_NAME} manually.`); }
    finally { setBusy(false); }
  };
  return <WalletGatePanel status={status} feature={feature} address={wallet?.address} chainId={wallet?.chainId} busy={busy} error={error}
    onConnect={() => { setError(''); connect?.(); }} onSwitch={() => void doSwitch()} />;
}

/** Compact header indicator: connected address and network, or a connect button. */
export function WalletStatusChip() {
  const { status, wallet, connect } = useEvmWallet();
  if (status === 'ready' && wallet) return <span className="wg-chip is-ok" title={wallet.address}><i aria-hidden />EVM {short(wallet.address)} · {TARGET_CHAIN_ID === MAINNET_ID ? 'ETH' : 'SEP'}</span>;
  if (status === 'wrong-network' && wallet) return <span className="wg-chip is-warn" title={wallet.address}><i aria-hidden />{short(wallet.address)} · wrong network</span>;
  return <button type="button" className="wg-chip is-off" onClick={() => connect?.()} disabled={status === 'unavailable'}><i aria-hidden />Connect wallet</button>;
}
