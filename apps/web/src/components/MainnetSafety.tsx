import { useEffect, useState, useSyncExternalStore } from 'react';
import { config } from '../lib/config';
import { useSession } from '../lib/session';
import { journalVersion, notifyJournal, readJournal, subscribeJournal, updateTransaction } from '../lib/mainnet-journal';
import { MAINNET_PAUSED, safeMainnetError } from '../lib/mainnet-safety';
import { mainnetClient, txUrl } from '../lib/railgun-runtime';
import { Button, Notice } from './ui';

export function MainnetSafety() {
  const { userId } = useSession();
  useSyncExternalStore(subscribeJournal, journalVersion);
  const [error, setError] = useState(''), [checking, setChecking] = useState(false);
  useEffect(() => { window.addEventListener('storage', notifyJournal); return () => window.removeEventListener('storage', notifyJournal); }, []);
  let entries: ReturnType<typeof readJournal> = [], storageError = '';
  try { if (userId) entries = readJournal(localStorage, userId); } catch { storageError = 'Transaction activity storage could not be read. Check browser storage and wallet activity before sending funds.'; }
  return <>
    {!config.mainnetTransactionsEnabled && <Notice tone="warning"><p><strong>Mainnet transfers are paused.</strong> {MAINNET_PAUSED} Vault backup, recovery, and synchronization remain available.</p></Notice>}
    {storageError && <Notice tone="warning"><p>{storageError}</p></Notice>}
    {entries.length > 0 && <section className="rg-panel" aria-label="Recent wallet transactions">
      <h2>Recent wallet activity</h2><p className="rg-note">A submitted or uncertain transaction is never retried automatically. Check its status before sending again.</p>
      <ul className="rg-review">{entries.slice(0, 8).map(entry => <li key={entry.id}>
        <span>{entry.status.replaceAll('_', ' ')} · {new Date(entry.createdAt).toISOString().replace('T', ' ').slice(0, 19)} UTC</span>
        {entry.hash ? <a href={txUrl(entry.hash)} target="_blank" rel="noreferrer">View transaction</a> : <span>Check your wallet activity</span>}
        {!entry.hash && ['awaiting_wallet', 'uncertain'].includes(entry.status) && <Button variant="secondary" onClick={() => {
          if (!userId || !window.confirm('First check the connected wallet for submitted or pending transactions. Clearing this local marker DOES NOT cancel a blockchain transaction. Continue only if you have confirmed that no transaction was sent or remains pending.')) return;
          try { updateTransaction(localStorage, userId, entry.id, 'cancelled'); setError(''); } catch { setError('Activity storage could not be updated. Keep the wallet activity open and do not send again.'); }
        }}>Resolve interrupted request</Button>}
        {entry.hash && ['pending', 'uncertain'].includes(entry.status) && <Button variant="secondary" busy={checking} onClick={async () => {
          if (!userId || !entry.hash) return; setChecking(true); setError('');
          try {
            const receipt = await mainnetClient.getTransactionReceipt({ hash: entry.hash });
            const head = await mainnetClient.getBlockNumber({ cacheTime: 0 });
            if (head < receipt.blockNumber + 1n) { setError('Waiting for two mainnet confirmations. Do not send again.'); return; }
            updateTransaction(localStorage, userId, entry.id, receipt.status === 'success' ? 'confirmed' : 'reverted');
          } catch { setError('Confirmation is not known yet. Check wallet activity or Etherscan; do not send again.'); }
          finally { setChecking(false); }
        }}>Check confirmation</Button>}
      </li>)}</ul>
      {error && <p role="alert" className="form-error">{safeMainnetError(new Error(error)) === error ? error : 'Confirmation is not known yet. Check wallet activity or Etherscan; do not send again.'}</p>}
    </section>}
  </>;
}
