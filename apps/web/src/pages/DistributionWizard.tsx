import { useRef, useState, type SetStateAction } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCheck, Download, FileUp, LockKeyhole, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { parsePrivacyProfile, parseAmount, randomBytes, serializeEnvelope, toHex, type CompiledDistribution } from '@null-protocol/sdk';
import { useStore, type Distribution, type RecipientRow } from '../lib/store';
import { amount, download, money, parseCsv, stringify } from '../lib/format';
import { protocolContext, sandboxContext } from '../lib/config';
import { cryptoTask } from '../lib/worker';
import { Badge, Button, KeyValue, Notice, PageHeader } from '../components/ui';

import { LiveOperationLoader, type LiveOperationInput } from '../components/LiveOperationLoader';
import { CreVerification } from '../components/CreVerification';
import { useWorkspaceAccess } from '../components/EnsAccessGate';
import type { CrePayrollExport } from '../lib/cre';
import { PaymentDestination } from '../components/PaymentDestination';
import { PaymentNameError, paymentDestination, recheckPaymentNames, requiredPaymentNames } from '@null-protocol/ens';
import { ensClient } from '../lib/ens';
import { preparePayout, type PayoutDraft } from '@null-protocol/payouts';
import { resolvePayoutJobRecipients } from '@null-protocol/payouts/jobs';

const steps = ['Details', 'People', 'Check', 'Review'];
const preparationCheckError = 'The payment did not pass its safety check. Nothing was sent. Prepare it again to continue.';
export function DistributionWizard() {
  const access = useWorkspaceAccess();
  const store = useStore(); const existing = store.distributions.find(item => item.id === store.editingId);
  const [id] = useState(existing?.id || crypto.randomUUID());
  const [step, setStep] = useState(0); const [name, setName] = useState(existing?.name || ''); const [category, setCategory] = useState(existing?.category || 'Payroll');
  const [rows, setRowsState] = useState<RecipientRow[]>(existing?.recipients || []);
  const rowVersion = useRef(0), preparing = useRef(false);
  const setRows = (next: SetStateAction<RecipientRow[]>) => { setError(''); rowVersion.current++; setRowsState(next); setCompiled(undefined); setCreVerified(false); };
  const [payoutDrafts, setPayoutDrafts] = useState<PayoutDraft[]>([]);
  const completedBatches = useRef(0);
  const paymentCompleted = useRef(false);
  const [creResults, setCreResults] = useState<Record<number, string>>({});
  const [creBatch, setCreBatch] = useState(0);
  const [payoutDraft, setPayoutDraft] = useState<PayoutDraft>();
  const [creResult, setCreResult] = useState<string>();
  const [compiled, setCompiled] = useState<CompiledDistribution | undefined>(undefined);
  const [creRequired, setCreRequired] = useState(store.mode === 'testnet');
  const [crePayroll, setCrePayroll] = useState<CrePayrollExport>();
  const [creVerified, setCreVerified] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [acknowledged, setAcknowledged] = useState(false); const [done, setDone] = useState(false);
  const [liveOperation, setLiveOperation] = useState<LiveOperationInput | null>(null);
  const [phase, setPhase] = useState(''); const upload = useRef<HTMLInputElement>(null);
  const total = rows.reduce((sum, row) => sum + amount(row.amount), 0n);
  const draft = (status: Distribution['status'] = 'Draft'): Distribution => ({ id, name: name.trim(), category, createdAt: existing?.createdAt || new Date().toISOString(), status, recipients: rows, ...(compiled ? { compiled } : {}) });
  const validate = () => {
    if (!name.trim()) return 'Give this payment a name.';
    if (!rows.length) return 'Add at least one ENS recipient and amount.';
    if (store.mode === 'sandbox' && rows.length > 8) return 'Practice mode supports up to eight recipients.';
    if (store.mode === 'testnet') {
      try { for (let offset = 0; offset < rows.length; offset += 8) requiredPaymentNames(rows.slice(offset, offset + 8)); } catch (reason) { return reason instanceof PaymentNameError ? reason.message : 'Check every recipient’s ENS payment name.'; }
    }
    const names = new Set<string>();
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]; const ref = row.name.trim().normalize('NFKC').toLowerCase();
      if (!ref) return `Add a name for recipient ${index + 1}.`;
      if (names.has(ref)) return `Use a different name or label for recipient ${index + 1}.`;
      names.add(ref);
      try { parseAmount(row.amount); } catch { return `Recipient ${index + 1} needs a positive amount with at most six decimal places.`; }
      try {
        const destination = paymentDestination(row.destination ?? row.profile);
        if (destination.kind === 'name' && (!row.paymentName || row.paymentName.name !== destination.name || row.paymentName.profile !== row.profile)) return `Check and confirm the ENS name for recipient ${index + 1}.`;
        parsePrivacyProfile(row.profile);
      } catch { return `Check the ENS name or Payment ID for recipient ${index + 1}. Ask them to share it from SQL; a wallet address will not work.`; }
    }
    return '';
  };
  const updateRow = (index: number, key: keyof RecipientRow, value: string) => { setRows(items => items.map((row, i) => index === i ? { ...row, [key]: value } : row)); setCompiled(undefined); };
  async function resolveAllNames() {
    if (busy || !rows.length) return;
    setBusy(true); setError(''); setPhase('Resolving all ENS payment names…');
    const version = rowVersion.current;
    try {
      const resolved = await resolvePayoutJobRecipients(ensClient, rows.map(row => ({ reference: row.name || row.destination || '', name: row.destination || '', amount: row.amount })));
      if (version !== rowVersion.current) throw new Error('Recipients changed. Resolve the current list again.');
      setRows(rows.map((row, index) => ({ ...row, name: row.name || resolved[index].name, destination: resolved[index].name, profile: resolved[index].paymentName.profile, paymentName: resolved[index].paymentName })));
      store.toast('ENS destinations resolved. Review the names and fingerprints before preparing.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not resolve all ENS names.'); }
    finally { setBusy(false); setPhase(''); }
  }
  async function importCsv(file?: File) {
    if (!file) return;
    try {
      if (file.size > 128000) throw new Error('Keep CSV files under 128 KB, with ENS names and amounts.');
      const parsed = parseCsv(await file.text());
      const headers = parsed.shift()?.map(value => value.toLowerCase().replace(/[ _-]/g, ''));
      const ensOnly = headers?.length === 2 && ['ens', 'name'].includes(headers[0]) && headers[1] === 'amount';
      if (!ensOnly && (!headers || headers[0] !== 'name' || headers[1] !== 'amount' || !['privacyprofile', 'paymentdestination'].includes(headers[2]) || headers.length !== 3)) throw new Error('Use two columns: ens,amount. The older name,amount,paymentDestination template also works.');
      if (parsed.length < 1 || store.mode === 'sandbox' && parsed.length > 8 || parsed.some(row => row.length !== (ensOnly ? 2 : 3))) throw new Error('Use the same columns on every row; practice mode supports eight recipients.');
      if (ensOnly) for (const row of parsed) row.push(row[0].trim());
      if (store.mode === 'testnet' && parsed.some(row => paymentDestination(row[2]).kind !== 'name')) throw new Error('Every CSV recipient needs an ENS payment name. Ask recipients to link their Payment IDs in their SQL inboxes first.');
      setRows(parsed.map(row => ({ id: crypto.randomUUID(), name: row[0], amount: row[1], destination: row[2].trim(), profile: row[2].trim().startsWith('st:eth:') ? row[2].trim() : '' }))); setError(''); setCompiled(undefined);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not read that CSV.'); }
    if (upload.current) upload.current.value = '';
  }
  async function prepare() {
    if (preparing.current) return;
    const invalid = validate(); if (invalid) { setError(invalid); return; }
    const context = store.mode === 'sandbox' ? sandboxContext : protocolContext;
    if (!context) { setError('Test network setup is incomplete. Open Advanced settings in Settings before continuing.'); return; }
    preparing.current = true; const version = rowVersion.current;
    setBusy(true); setError(''); setPhase('Preparing payment…'); setCreVerified(false); setCrePayroll(undefined); setPayoutDraft(undefined); setPayoutDrafts([]); setCreResult(undefined); setCreResults({}); setCreBatch(0);
    const entropy = randomBytes(32);
    try {
      await access.verify();
      setPhase('Checking recipient names on Sepolia…');
      if (store.mode === 'sandbox') await recheckPaymentNames(ensClient, rows.flatMap(row => row.paymentName ? [row.paymentName] : []));
      setPhase('Preparing payment…');
      const options = { recipients: rows.map(row => ({ employeeRef: row.name, amountAtomic: parseAmount(row.amount), stealthMetaAddress: row.profile })), context, batchEntropy: entropy };
      let first: CompiledDistribution;
      let preparedPayout: PayoutDraft | undefined;
      if (store.mode === 'testnet') {
        const drafts: PayoutDraft[] = [];
        for (let offset = 0; offset < rows.length; offset += 8) {
          const group = rows.slice(offset, offset + 8);
          const names = requiredPaymentNames(group);
          setPhase('Preparing private batch ' + (drafts.length + 1) + ' of ' + Math.ceil(rows.length / 8) + '…');
          drafts.push(await preparePayout({ ens: ensClient, context,
            recipients: group.map((row, index) => ({ reference: row.name, amount: row.amount, name: names[index].name, paymentName: names[index] })),
            compiler: input => cryptoTask('compile', input),
          }));
        }
        preparedPayout = drafts[0]; first = preparedPayout.compiled;
        setPayoutDrafts(drafts);
      } else {
        first = await cryptoTask('compile', options);
        const second = await cryptoTask('compile', options);
        if (stringify(first.publicBundle) !== stringify(second.publicBundle) || first.allocationRoot !== second.allocationRoot || first.envelopes.length !== 8 || new Set(first.envelopes.map(envelope => serializeEnvelope(envelope).length)).size !== 1) throw new Error(preparationCheckError);
      }
      if (version !== rowVersion.current) throw new PaymentNameError('changed', 'The recipients changed during preparation. Check this payment again. Nothing was sent.');
      setCompiled(first); setPayoutDraft(preparedPayout);
      if (creRequired) setCrePayroll(preparedPayout ? preparedPayout.creInput : { batchId: crypto.randomUUID(), batchEntropyHex: toHex(entropy), recipients: options.recipients.map(recipient => ({ ...recipient, amountAtomic: recipient.amountAtomic.toString() })) });
      setStep(2);
    } catch (reason) { setCompiled(undefined); setError(reason instanceof PaymentNameError ? reason.message : reason instanceof Error && reason.message === preparationCheckError ? preparationCheckError : 'Could not prepare this payment. Nothing has been sent. Try again.'); }
    finally { entropy.fill(0); preparing.current = false; setBusy(false); setPhase(''); }
  }
  async function publish() {
    if (!acknowledged || !compiled || busy || creRequired && !creVerified) return;
    setBusy(true); setError('');
    try { store.publish(draft('Prepared')); setDone(true); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not finish this practice payment. Try again.'); } finally { setBusy(false); }
  }
  if (done) return <><PageHeader title="Practice payment sent" description="This payment is available for this browser session." /><div className="completion"><span className="completion-icon"><CheckCheck size={30} strokeWidth={1.5} /></span><Badge tone="success">Sent in practice</Badge><h2>{name}</h2><p>Recipients can now collect their practice payments in this browser session.</p><div className="completion-details"><KeyValue label="Total">{money(total, true)} USDC</KeyValue><KeyValue label="Recipients">{rows.length}</KeyValue></div><Notice>No real money moved. Practice mode does not request organization approval.</Notice><div className="button-row"><Button onClick={() => store.navigate('distributions')}>View payments<ArrowRight size={16} /></Button></div><p className="field-hint">If you used sample recipients, switch to Individual in Settings to try collecting.</p></div></>;
  return <>
    <PageHeader title={existing ? 'Prepare payment' : 'New payment'} action={<div className="button-row">{existing && <Button variant="ghost" icon={Trash2} onClick={() => { store.removeDraft(id); store.toast('Draft discarded.'); store.navigate('distributions'); }}>Discard draft</Button>}<Button variant="secondary" disabled={busy} onClick={() => { if (!name.trim()) { setError('Give your draft a name before saving.'); return; } store.saveDistribution(draft(compiled ? 'Prepared' : 'Draft')); store.toast('Draft saved for this session.'); store.navigate('distributions'); }}>Save draft</Button></div>} />
    <div className="wizard-layout"><div className="wizard-main"><ol className="stepper">{steps.map((label, index) => <li key={label} className={step === index ? 'current' : step > index ? 'complete' : ''} aria-current={step === index ? 'step' : undefined}><span>{step > index ? <Check size={13} /> : index + 1}</span><strong>{label}</strong></li>)}</ol>
      <fieldset className="wizard-surface" disabled={busy}>
      {step === 0 && <><div className="form-section-heading"><h2>Payment details</h2></div><label className="field">Payment name<input maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. September payroll" autoFocus /></label><label className="field">Payment type<select value={category} onChange={event => setCategory(event.target.value)}>{['Payroll', 'Contractors', 'Grants', 'Contributors', 'Other payouts'].map(value => <option key={value}>{value}</option>)}</select></label><Notice>{store.mode === 'sandbox' ? 'Practice mode uses sample USDC. No real money moves.' : 'Test USDC only. Withdrawals reveal the destination and amount.'}</Notice></>}
      {step === 1 && <><div className="form-section-heading"><h2>Who are you paying?</h2><p>Enter ENS names and amounts. Larger lists are sent as consecutive private batches of up to eight recipients.</p></div><div className="import-strip"><FileUp size={22} strokeWidth={1.5} /><div><strong>Import CSV</strong></div><Button variant="secondary" onClick={() => upload.current?.click()}>Choose file</Button><input ref={upload} type="file" accept=".csv,text/csv" hidden onChange={event => void importCsv(event.target.files?.[0])} /></div><div className="import-options"><button className="text-link" onClick={() => download('sql-payroll-template.csv', store.mode === 'sandbox' ? 'name,amount,paymentDestination\n' + store.recipients.map(row => `"${row.name.replaceAll('"', '""')}",${row.amount},${row.profile}`).join('\n') : 'ens,amount\n', 'text/csv')}>Download CSV template<Download size={13} /></button>{store.mode === 'sandbox' && <button className="text-link" onClick={() => { setRows(store.recipients.map(row => ({ ...row, id: crypto.randomUUID() }))); setCompiled(undefined); }}>Use sample recipients</button>}</div>
      <fieldset className="recipient-editor" disabled={busy}>{rows.map((row, index) => <div className="recipient-edit-row" key={row.id}>
        <div className="recipient-row-heading"><span className="person-avatar">{row.name.trim().slice(0, 1).toUpperCase() || index + 1}</span><strong>Recipient {index + 1}</strong><button className="icon-button" aria-label={`Remove recipient ${index + 1}`} onClick={() => setRows(items => items.filter(item => item.id !== row.id))}><Trash2 size={15} /></button></div>
        <PaymentDestination row={row} onChange={(destination, profile, paymentName) => { setRows(items => items.map(item => item.id === row.id ? { ...item, name: paymentName?.name ?? destination, destination, profile, paymentName } : item)); setAcknowledged(false); }} />
        <div className="form-two">{store.mode === 'sandbox' && <label className="field">Name or label<input value={row.name} maxLength={100} onChange={event => updateRow(index, 'name', event.target.value)} placeholder="Alice Chen" /></label>}<label className="field">Amount in USDC<input value={row.amount} inputMode="decimal" onChange={event => updateRow(index, 'amount', event.target.value)} placeholder="0.00" /></label></div>
      </div>)}</fieldset>{(store.mode === 'testnet' || rows.length < 8) && <Button variant="secondary" icon={Plus} className="add-recipient" onClick={() => setRows(items => [...items, { id: crypto.randomUUID(), name: '', amount: '', profile: '' }])}>Add recipient</Button>}<p className="field-hint"><LockKeyhole size={13} />Drafts and CSV data last for this session.</p></>}
      {step === 1 && store.mode === 'testnet' && <Button variant="secondary" disabled={busy || !rows.length} onClick={() => void resolveAllNames()}>Resolve all ENS names</Button>}
      {step === 1 && store.mode === 'testnet' && <label className="checkbox-field"><input type="checkbox" checked={creRequired} onChange={event => { setCreRequired(event.target.checked); setCreVerified(false); setCrePayroll(undefined); setCompiled(undefined); }} /><span>Verify with Chainlink CRE (local simulation)</span></label>}
      {step === 2 && compiled && <><div className="form-section-heading"><h2>{creRequired && !creVerified ? 'Complete CRE check ' + (creBatch + 1) + ' of ' + Math.max(1, payoutDrafts.length) : 'Ready to review'}</h2><p>Nothing sent yet.</p></div><div className="preflight-summary"><KeyValue label="Recipients">{rows.length}</KeyValue><KeyValue label="Total">{money(total, true)} USDC</KeyValue></div><Notice>{store.mode === 'sandbox' ? 'Next, review and complete your practice payment. It will be available for this browser session only.' : 'Organization approval is required before sending.'}</Notice></>}
      {step === 2 && compiled && creRequired && crePayroll && <CreVerification key={crePayroll.batchId} payroll={crePayroll} expected={payoutDrafts[creBatch]?.publicBundle ?? compiled.publicBundle} onVerified={(_bundle, result) => {
        setCreResult(result);
        const verified = { ...creResults, [creBatch]: result }; setCreResults(verified);
        if (creBatch + 1 < payoutDrafts.length) { setCreBatch(creBatch + 1); setCrePayroll(payoutDrafts[creBatch + 1].creInput); }
        else { setCreVerified(true); setCrePayroll(undefined); }
      }} />}
      {step === 2 && compiled && creRequired && creVerified && <Notice>CRE checks passed: batch, network, pool and all eight encrypted envelopes match for each batch. Review is unlocked. Local simulation only; no remote enclave attestation.</Notice>}
      {step === 3 && compiled && <><div className="form-section-heading"><h2>Review your payment</h2><p>{store.mode === 'sandbox' ? 'Check the amount before completing this practice payment.' : 'Check recipients and amounts.'}</p></div><div className="review-amount"><span>{name}</span><strong>{money(total, true)}<small>USDC</small></strong></div><div className="review-recipients">{rows.map(row => <div key={row.id}><strong><bdi>{row.paymentName?.name || row.name}</bdi></strong><span>{money(parseAmount(row.amount), true)} USDC</span><small>{row.paymentName ? row.paymentName.name : 'Payment ID'} · {row.paymentName ? 'Checked on Sepolia' : 'Provided directly'}</small></div>)}</div><div className="detail-list"><KeyValue label="Payment type">{category}</KeyValue><KeyValue label="Pay from">{store.mode === 'sandbox' ? 'Practice funds' : 'Test network funds'}</KeyValue></div>{store.mode === 'sandbox' ? <label className="checkbox-field"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>This is a practice payment for this browser session. No real money moves and no organization approval is requested.</span></label> : <Notice tone="warning">Next: unlock funds and approve. Test USDC only.</Notice>}</>}
      {error && <div className="form-error" role="alert">{error}</div>}{busy && <p className="processing-status" role="status">{phase}</p>}
      <div className="wizard-actions"><Button variant="ghost" icon={ArrowLeft} disabled={busy} onClick={() => { setError(''); step === 0 ? store.navigate('distributions') : setStep(step - 1); }}>{step === 0 ? 'Cancel' : 'Back'}</Button>{step === 0 ? <Button onClick={() => { if (!name.trim()) { setError('Give this payment a name.'); return; } setError(''); setStep(1); }}>Add recipients<ArrowRight size={15} /></Button> : step === 1 ? <Button busy={busy} icon={ShieldCheck} onClick={() => void prepare()}>Check payment</Button> : step === 2 ? <Button disabled={creRequired && !creVerified} onClick={() => setStep(3)}>Review payment<ArrowRight size={15} /></Button> : store.mode === 'sandbox' ? <Button busy={busy} disabled={!acknowledged || total > store.treasury || creRequired && !creVerified} onClick={() => void publish()}>Complete practice payment<ArrowRight size={15} /></Button> : <Button disabled={creRequired && !creVerified} icon={ShieldCheck} onClick={() => { if (compiled && payoutDraft && (!creRequired || creVerified && creResult)) setLiveOperation({ kind: 'create_distribution', compiled, paymentNames: payoutDraft.paymentNames, draft: payoutDraft, compilation: creRequired ? { mode: 'cre-local-simulation', result: creResults[0]! } : { mode: 'local' }, batches: payoutDrafts.map((draft, index) => ({ draft, compilation: creRequired ? { mode: 'cre-local-simulation', result: creResults[index]! } : { mode: 'local' } })) }); }}>Send payout</Button>}</div></fieldset></div>
      <aside className="wizard-aside"><div className="summary-heading"><LockKeyhole size={17} /><h3>Payment summary</h3></div><KeyValue label="Recipients">{rows.length}</KeyValue><div className="summary-total"><span>Total payment</span><strong>{money(total)}<small>USDC</small></strong></div>{total > store.treasury && store.mode === 'sandbox' && <Notice tone="warning">You need more practice funds for this payment. Open Funds to add them.</Notice>}</aside>
    </div>
    <LiveOperationLoader operation={liveOperation} onClose={() => {
      setLiveOperation(null);
      if (paymentCompleted.current) { store.navigate('distributions'); return; }
      if (completedBatches.current > 0 && completedBatches.current < payoutDrafts.length) {
        setRows(rows.slice(completedBatches.current * 8)); setPayoutDrafts([]); setPayoutDraft(undefined); setStep(1); completedBatches.current = 0;
      }
    }} onBatchConfirmed={(result, index) => {
      completedBatches.current = index + 1;
      store.saveDistribution({ ...draft('Confirmed'), id: `${id}-batch-${index}`, name: `${name} · batch ${index + 1}`, recipients: rows.slice(index * 8, (index + 1) * 8), compiled: payoutDrafts[index]?.compiled, transactionHash: result.transactionHash });
      const remaining = rows.slice((index + 1) * 8);
      if (remaining.length) store.saveDistribution({ ...draft('Draft'), compiled: undefined, recipients: remaining });
    }} onConfirmed={result => {
      if (payoutDrafts.length > 1) store.removeDraft(id);
      else store.saveDistribution({ ...draft('Confirmed'), transactionHash: result.transactionHash });
      paymentCompleted.current = true;
      store.toast('Payout confirmed on the test network. Download its receipts, then choose Done.');
    }} />
  </>;
}
