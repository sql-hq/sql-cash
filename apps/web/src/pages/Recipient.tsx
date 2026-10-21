import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Copy, Download, Inbox, KeyRound, LockKeyhole, RefreshCw } from 'lucide-react';
import { buildPrivateNote, finalizePrivateNote, type DiscoveredAllocation } from '@null-protocol/sdk';
import { resolvePaymentName } from '@null-protocol/ens';
import { ensClient } from '../lib/ens';
import { useStore } from '../lib/store';
import { config, sandboxContext } from '../lib/config';
import { date, money } from '../lib/format';
import { cryptoTask } from '../lib/worker';
import { Badge, Button, EmptyState, Modal, Notice, PageHeader, SectionTitle } from '../components/ui';
import { Recovery } from '../components/Recovery';
import { LiveOperationLoader, type LiveOperationInput } from '../components/LiveOperationLoader';

const PaymentNameManager = lazy(() => import('../components/PaymentNameManager').then(module => ({ default: module.PaymentNameManager })));

export function PrivateInbox() {
  const store = useStore();
  const [allocations, setAllocations] = useState<DiscoveredAllocation[]>([]);
  const currentAllocations = useRef<DiscoveredAllocation[]>([]);
  const [liveOperation, setLiveOperation] = useState<LiveOperationInput | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState('');
  const [forceRpc, setForceRpc] = useState(false);
  const [recovery, setRecovery] = useState<'export' | 'restore' | null>(null);
  const [selected, setSelected] = useState<DiscoveredAllocation | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [profileExpanded, setProfileExpanded] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [copying, setCopying] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [setupName, setSetupName] = useState<string>();
  const scanRevision = useRef(0), scanInFlight = useRef(false);
  const identityRevision = useRef(0);
  useEffect(() => {
    identityRevision.current++; setCopying(false);
    scanRevision.current++; scanInFlight.current = false; setScanning(false);
    for (const item of currentAllocations.current) item.stealthPrivateKey.fill(0);
    currentAllocations.current = [];
    setAllocations([]); setScanned(false); setSelected(null); setError(''); setCopyError('');
    return () => {
      identityRevision.current++;
      scanRevision.current++;
      for (const item of currentAllocations.current) item.stealthPrivateKey.fill(0);
    };
  }, [store.mode, store.identity]);
  const consumed = new Set(store.notes.map(note => note.allocationId));
  const available = allocations.filter(item => !consumed.has(item.id));

  async function copyProfile() {
    if (!store.identityBackedUp) { setRecovery('export'); return; }
    if (store.mode === 'testnet' && !store.receivingName) { setNameOpen(true); return; }
    const version = identityRevision.current;
    setCopyError(''); setCopying(true);
    try {
      let value = store.identity.profile.stealthMetaAddress;
      if (store.receivingName) {
        const fresh = await resolvePaymentName(ensClient, store.receivingName.name);
        if (version !== identityRevision.current) return;
        if (fresh.profile !== value) {
          store.setReceivingName(undefined); setNameOpen(true);
          setCopyError('This name’s Payment ID changed. Link your Payment ID again before sharing.');
          return;
        }
        value = fresh.name;
      }
      await navigator.clipboard.writeText(value);
      if (version === identityRevision.current) store.toast(store.receivingName ? 'ENS name copied.' : 'Payment ID copied.');
    } catch {
      if (version !== identityRevision.current) return;
      setProfileExpanded(true);
      setCopyError(store.mode === 'testnet' ? 'Could not verify and copy your ENS name. Check the name settings and try again. Existing payments remain accessible.' : 'Could not copy. Select your Payment ID below and copy it.');
    } finally { if (version === identityRevision.current) setCopying(false); }
  }

  async function scan(useAnotherConnection = forceRpc) {
    if (scanInFlight.current) return;
    scanInFlight.current = true;
    const version = ++scanRevision.current;
    setScanning(true); setError('');
    try {
      let result: DiscoveredAllocation[];
      if (store.mode === 'sandbox') {
        const published = store.distributions.filter(item => item.status === 'Published locally' && item.compiled).map(item => item.compiled!);
        result = await cryptoTask('scan', { envelopes: published.flatMap(item => item.envelopes), distributions: published.map(item => item.publicBundle), keys: store.identity.keys, context: sandboxContext, source: 'local' });
      } else {
        if (!config.poolAddress) throw new Error('The test network is not ready. Open Settings to check the connection.');
        const {NullLiveClient,validateDeploymentManifest} = await import('@null-protocol/client');
        const response = await fetch(config.manifestUrl, {credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15_000)});
        if (!response.ok) throw new Error('Deployment unavailable');
        const manifest = await response.json(); validateDeploymentManifest(manifest);
        if (manifest.chainId !== Number(config.chainId) || manifest.contracts.nullPool.toLowerCase() !== config.poolAddress.toLowerCase()) throw new Error('Deployment mismatch');
        const client = new NullLiveClient({manifest,rpcUrls:config.rpcUrls,graphUrl:config.graphUrl,artifactBaseUrl:window.location.origin,confirmations:config.confirmations,persistLocalSecret:async()=>{throw new Error('Inbox discovery is read-only');}});
        const found = await client.discover({keys:store.identity.keys,forceRpc:useAnotherConnection});
        result = found.filter(item => { if (item.spent) {item.stealthPrivateKey.fill(0);return false;} return true; });
      }
      // A restore or account change must not display results from the old keys.
      if (version !== scanRevision.current) {
        for (const item of result) item.stealthPrivateKey.fill(0);
        return;
      }
      for (const item of currentAllocations.current) item.stealthPrivateKey.fill(0);
      currentAllocations.current = result; setAllocations(result); setScanned(true);
    } catch (reason) {
      if (version !== scanRevision.current) return;
      setError(reason instanceof Error && reason.message === 'The test network is not ready. Open Settings to check the connection.' ? reason.message : 'Could not check for payments. Try again or check the connection in Settings.');
    } finally { if (version === scanRevision.current) { scanInFlight.current = false; setScanning(false); } }
  }

  function claim() {
    if (!selected || claiming || store.mode !== 'sandbox') return;
    setClaiming(true);
    try {
      if (consumed.has(selected.id)) throw new Error('This payment has already been collected.');
      const draft = buildPrivateNote(selected); const note = finalizePrivateNote(draft, store.notes.length);
      store.addNote({ id: crypto.randomUUID(), amount: note.amountAtomic, commitment: note.commitment, allocationId: selected.id, createdAt: new Date().toISOString() });
      setSelected(null); store.toast('Practice payment collected. View it in your balance.');
    } catch { setError('Could not collect this practice payment. Check your inbox again.'); }
    finally { setClaiming(false); }
  }

  return <>
    <PageHeader title="Your inbox" action={<Button icon={RefreshCw} busy={scanning} onClick={() => void scan()}>{scanning ? 'Checking…' : scanned ? 'Check again' : 'Check for payments'}</Button>} />
    <section className="receive-panel" aria-label="Receive payments">
    <div className="receive-heading">
      <span className="profile-symbol"><KeyRound size={21} strokeWidth={1.6} /></span>
      <div className="receive-label"><h2>{store.receivingName?.name || (store.mode === 'testnet' ? 'Set up your inbox' : 'Receive payments')}</h2><p>{store.receivingName ? 'Share this name with the sender.' : store.mode === 'testnet' ? 'Choose a name, keep a backup, and you’re ready to receive.' : 'Share your Payment ID with the sender.'}</p></div>
      {(store.mode !== 'testnet' || store.receivingName && !nameOpen) && <Button variant="secondary" icon={Copy} busy={copying} onClick={() => void copyProfile()}>{!store.identityBackedUp ? 'Save backup to receive' : store.receivingName ? 'Copy ENS name' : 'Copy Payment ID'}</Button>}
    </div>
    {(store.receivingName || store.mode !== 'testnet') && <div className="receive-tools"><span>ENS · Sepolia</span><button className="text-link" aria-expanded={nameOpen} aria-controls="receive-name-settings" onClick={() => setNameOpen(value => !value)}>{nameOpen ? 'Close name settings' : store.receivingName ? 'Manage ENS name' : 'Link ENS name'}<ArrowRight size={14} /></button></div>}
    {copyError && <p className="form-error" role="alert">{copyError}</p>}
    {(nameOpen || store.mode === 'testnet' && !store.receivingName) && <div id="receive-name-settings"><Suspense fallback={<p role="status">Opening inbox setup…</p>}><PaymentNameManager key={store.identity.profile.stealthMetaAddress} initialName={setupName} onNameChange={setSetupName} onRecovery={setRecovery} onLinked={() => setNameOpen(true)} /></Suspense></div>}
    </section>
    <div className="receive-backup"><span>{store.identityBackedUp ? 'Keep your backup and password in separate safe places.' : 'Returning to an existing inbox?'}</span><div>{store.identityBackedUp && <button className="text-link" onClick={() => setRecovery('export')}>Save backup</button>}<button className="text-link" onClick={() => setRecovery('restore')}>Restore backup</button></div></div>
    <div className="inbox-toolbar"><div><h2>Payments</h2>{scanned && <Badge>{available.length} available</Badge>}</div>{store.notes.length > 0 && <button className="text-link" onClick={() => store.navigate('balance')}>View balance<ArrowRight size={14} /></button>}</div>
    {error && <div className="form-error" role="alert">{error}{store.mode === 'testnet' && <Button variant="ghost" disabled={scanning} onClick={() => { setForceRpc(true); void scan(true); }}>Try another connection</Button>}</div>}
    {scanning ? <div className="scan-loading" role="status"><span className="skeleton skeleton-title" /><span className="skeleton" /><span className="skeleton skeleton-short" /><p>Checking for payments on your device…</p></div> : available.length ? <div className="entitlement-list">{available.map((item, index) => <article className="entitlement" key={item.id}>
      <div className="entitlement-top"><span className="entitlement-symbol"><Inbox size={22} strokeWidth={1.5} /></span><Badge tone={item.source === 'local' || item.confirmed ? 'success' : 'warning'} dot>{item.source === 'local' || item.confirmed ? 'Ready to collect' : 'Waiting for confirmation'}</Badge></div>
      <h3>{store.distributions.find(distribution => distribution.compiled?.commitment === item.distributionCommitment)?.name || `Payment ${index + 1}`}</h3>
      <div className="entitlement-amount">{store.hideBalances ? '••••••' : money(item.amountAtomic, true)}<span>USDC</span></div>
      <p className="entitlement-privacy">{item.source === 'local' ? 'Practice payment. No real money is transferred.' : item.confirmed ? 'Collect this test payment to add it to your balance.' : 'The test network is still confirming this payment.'}</p>
      <Button disabled={item.source === 'chain' && !item.confirmed} onClick={() => setSelected(item)}>Collect payment<ArrowRight size={15} /></Button>
    </article>)}</div> : <div className="inbox-empty"><EmptyState icon={Inbox} title={scanned ? allocations.length ? 'All collected' : 'No new payments' : 'No payments checked yet'} description={scanned ? allocations.length ? 'Find collected payments in your balance.' : 'Expecting a payment? Check again, or restore your backup.' : 'Received a payment? Check your inbox above.'} /></div>}
    <details className="progressive-details" open={profileExpanded} onToggle={event => setProfileExpanded(event.currentTarget.open)}>
      <summary>View Payment ID</summary>
      <p>{store.mode === 'testnet' ? 'This public ID is the record behind your ENS inbox. Senders use your linked ENS name for new payments. Keep your backup and password private.' : 'Share this ID, not your wallet address. Keep your backup and password private.'}</p>
      <label className="field">Payment ID<textarea className="mono-input" readOnly rows={3} value={store.identity.profile.stealthMetaAddress} onFocus={event => event.currentTarget.select()} /></label>
    </details>
    <Modal title="Collect payment" description="Add this payment to your balance." open={!!selected} onClose={() => { if (!claiming) setSelected(null); }}>
      {selected && <>
        <div className="claim-amount">{store.hideBalances ? '••••••' : money(selected.amountAtomic, true)}<span>USDC</span></div>
        {selected.source === 'local' ? <Notice>Sample money only. Resets when you reload.</Notice> : <Notice tone="warning">Test USDC only. Save a backup in the next step. Collect first, then withdraw from Balance.</Notice>}
        <div className="modal-actions"><Button variant="secondary" onClick={() => setSelected(null)}>Keep in inbox</Button><Button busy={claiming} icon={LockKeyhole} onClick={() => { if (selected.source === 'local') claim(); else { setLiveOperation({ kind: 'claim', allocation: selected }); setSelected(null); } }}>{selected.source === 'local' ? 'Collect payment' : 'Continue'}</Button></div>
      </>}
    </Modal>
    <LiveOperationLoader operation={liveOperation} onClose={() => setLiveOperation(null)} onConfirmed={result => { if ('claimNullifier' in result.note) store.addNote({ id: crypto.randomUUID(), amount: result.note.amountAtomic, commitment: result.note.commitment, allocationId: result.note.claimNullifier, createdAt: new Date().toISOString() }); store.toast('Collected into your private SQL balance. Withdraw to move USDC to your wallet.'); }} />
    <Recovery key={recovery || 'closed'} open={recovery !== null} initialMode={recovery || 'export'} continueSetup={store.mode === 'testnet' && !store.receivingName} onClose={() => setRecovery(null)} />
  </>;
}

export function PrivateBalance() {
  const store = useStore();
  const [recovery, setRecovery] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const total = store.notes.reduce((sum, note) => sum + note.amount, 0n);

  return <>
    <PageHeader title="Your balance" action={store.mode === 'testnet' ? <Button variant="secondary" icon={RefreshCw} onClick={store.recoverLiveBalances}>Restore balance</Button> : undefined} />
    <div className="private-balance-panel">
      <div className="balance-label"><span><LockKeyhole size={18} />Balance</span><Badge tone="purple">{store.mode === 'sandbox' ? 'Practice mode' : 'Test money'}</Badge></div>
      <div className="balance-value">{store.hideBalances ? '••••••' : money(total)}<span>USDC</span></div>
      <p>{store.notes.length} collected payment{store.notes.length !== 1 ? 's' : ''} in this session</p>
      <p>{store.mode === 'testnet' ? 'USDC stays in the pool while it is in your private balance. Withdraw to transfer it to your wallet; the amount and destination become public.' : 'Practice balances cannot be withdrawn.'}</p>
      <div className="button-row">{store.mode === 'testnet' && <Button onClick={() => setWithdraw(true)} icon={ArrowUpRight}>Withdraw</Button>}<Button variant="secondary" onClick={() => store.navigate('inbox')}>Open inbox<ArrowRight size={15} /></Button></div>
    </div>
    <section className="section-block">
      <SectionTitle title="Collected payments" />
      <div className="table-panel">{store.notes.length ? <div className="table-scroll"><table>
        <thead><tr><th>Payment</th><th>Amount</th><th>Collected</th></tr></thead>
        <tbody>{store.notes.map((note, index) => <tr key={note.id}>
          <td><strong>Payment {index + 1}</strong></td>
          <td className="numeric">{store.hideBalances ? '••••••' : money(note.amount, true)} <span className="currency">USDC</span></td>
          <td>{date(note.createdAt)}</td>
        </tr>)}</tbody>
      </table></div> : <EmptyState icon={LockKeyhole} title="Nothing collected yet" description="Collect a payment from your inbox." />}</div>
    </section>
    <details className="progressive-details">
      <summary>Keep access to your funds</summary>
      <p>Save a backup to keep access to your Payment ID. It does not save practice payments or drafts.</p>
      <div className="button-row"><Button variant="secondary" icon={Download} onClick={() => setRecovery(true)}>Save backup</Button></div>
    </details>
    <Recovery key={recovery ? 'open' : 'closed'} open={recovery} onClose={() => setRecovery(false)} />
    <LiveOperationLoader operation={withdraw ? {kind:'withdraw',treasury:false} : null} onClose={() => setWithdraw(false)} onConfirmed={result => {if(result.withdrawal)store.toast('Withdrawal confirmed. Your remaining private balance has been updated.');}} />
  </>;
}
