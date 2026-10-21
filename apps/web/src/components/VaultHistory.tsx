import { useEffect, useState } from 'react';
import { formatUsdc, USDC } from '@silentquery/railgun';
import { type VaultRecord, loadEngine, txUrl } from '../lib/railgun-runtime';
import { vaultContext } from '../lib/vault-safety';
import { Button } from './ui';
import { useStore } from '../lib/store';

type Engine = Awaited<ReturnType<typeof loadEngine>>;
type History = Awaited<ReturnType<Engine['vaultHistory']>>;
const labels: Record<string, string> = { ShieldERC20s: 'Deposit', UnshieldERC20s: 'Withdrawal', TransferSendERC20s: 'Private payout', TransferReceiveERC20s: 'Private receipt' };
function time(timestamp: number | undefined) {
  if (timestamp === undefined) return 'Time unavailable';
  const date = new Date(timestamp * 1000);
  return Number.isFinite(date.getTime()) ? `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC` : 'Time unavailable';
}
function amount(value: bigint) { try { return `${formatUsdc(value)} USDC`; } catch { return 'Amount unavailable'; } }
export function VaultHistory({ engine, record, owner, synchronized, refreshKey }: { engine: Engine; record: VaultRecord; owner: string; synchronized: boolean; refreshKey: unknown }) {
  const { hideBalances } = useStore();
  const [items, setItems] = useState<History | null>(null), [error, setError] = useState(''), [limit, setLimit] = useState(50);
  useEffect(() => {
    let live = true; setItems(null); setError('');
    if (!synchronized) return;
    const guard = vaultContext(owner);
    void engine.vaultHistory(record).then(history => { guard(); if (live) setItems([...history].sort((a, b) => (b.blockNumber ?? 0) - (a.blockNumber ?? 0))); })
      .catch(() => { if (live) setError('Private history could not be read. Synchronize again; an empty list does not mean that no funds exist.'); });
    return () => { live = false; };
  }, [engine, record.walletId, owner, synchronized, refreshKey]);
  return <section className="rg-panel" aria-label="Private transaction history"><header className="rg-panel-head"><h2>Private transaction history</h2></header>
    <p className="rg-note">Decrypted locally while this vault is unlocked. No private history is uploaded to the application server.</p>
    {!synchronized ? <p role="status" className="rg-note">History synchronization is not complete. Use Full history scan after recovery; do not rely on a partial balance or an empty list.</p>
      : error ? <p className="form-error" role="alert">{error}</p>
      : items === null ? <p role="status">Reading private history…</p>
      : items.length === 0 ? <p className="rg-note">No transactions were found in the synchronized local history. If you expect older activity, run a full history scan from deployment.</p>
      : <>
        <p className="rg-note">{items.length} transactions · timestamps in UTC</p>
        <ol className="rg-review">{items.slice(0, limit).map((item, index) => {
          const hash = item.txid.startsWith('0x') ? item.txid : `0x${item.txid}`;
          const transfers = [...item.receiveERC20Amounts.map(row => ({ ...row, direction: 'Received' })), ...item.transferERC20Amounts.map(row => ({ ...row, direction: 'Sent' })), ...item.unshieldERC20Amounts.map(row => ({ ...row, direction: 'Withdrawn' }))]
            .filter(row => row.tokenAddress.toLowerCase() === USDC.address.toLowerCase());
          return <li key={`${item.txidVersion}:${item.txid}:${index}`} style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
            <strong>{labels[item.category] ?? 'Private activity'}</strong><span>{time(item.timestamp)}{item.blockNumber !== undefined ? ` · block ${item.blockNumber}` : ''}</span>
            {transfers.map((row, i) => <span key={i}>{row.direction}: {hideBalances ? 'Hidden' : amount(row.amount)}</span>)}
            {/^(0x)[0-9a-f]{64}$/i.test(hash) && <a href={txUrl(hash)} target="_blank" rel="noreferrer">View public transaction</a>}
            {transfers.some(row => row.memoText) && <details><summary>Private memo</summary>{transfers.filter(row => row.memoText).map((row, i) => <p key={i}>{row.memoText}</p>)}</details>}
          </li>;
        })}</ol>
        {limit < items.length && <Button variant="secondary" onClick={() => setLimit(value => value + 50)}>Show 50 more</Button>}
      </>}
  </section>;
}
