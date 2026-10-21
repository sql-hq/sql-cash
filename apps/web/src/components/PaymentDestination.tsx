import { useEffect, useId, useRef, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { PaymentNameError, paymentDestination, resolvePaymentName, samePaymentDestination, type PaymentNameSnapshot } from '@null-protocol/ens';
import { ensClient } from '../lib/ens';
import { useStore, type RecipientRow } from '../lib/store';
import { Button } from './ui';

export function PaymentDestination({ row, onChange }: { row: RecipientRow; onChange: (destination: string, profile: string, paymentName?: PaymentNameSnapshot) => void }) {
  const store = useStore();
  const fieldId = useId();
  const [candidate, setCandidate] = useState<PaymentNameSnapshot>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const revision = useRef(0);
  const destination = row.destination ?? row.profile;
  useEffect(() => { revision.current++; setCandidate(undefined); setError(''); setBusy(false); }, [destination]);
  useEffect(() => () => { revision.current++; }, []);
  async function check() {
    const current = ++revision.current; setError(''); setCandidate(undefined); setBusy(true);
    try {
      const parsed = paymentDestination(destination);
      if (parsed.kind === 'profile') {
        if (store.mode === 'testnet') throw new PaymentNameError('missing', 'Ask the recipient for their ENS payment name. They must link their Payment ID in their SQL inbox first.');
        onChange(parsed.profile, parsed.profile); return;
      }
      const result = await resolvePaymentName(ensClient, parsed.name);
      if (current === revision.current) setCandidate(result);
    } catch (reason) { if (current === revision.current) setError(reason instanceof PaymentNameError ? reason.message : 'Could not check this name. Try again.'); }
    finally { if (current === revision.current) setBusy(false); }
  }
  const previous = candidate && (row.paymentName ?? store.paymentPins[candidate.name]);
  const changed = !!(previous && candidate && !samePaymentDestination(previous, candidate));
  return <div className="payment-destination">
    <label className="field" htmlFor={fieldId}>{store.mode === 'testnet' ? 'ENS payment name' : 'ENS name or Payment ID'}</label>
    <div className="name-input-row"><input id={fieldId} value={destination} maxLength={512} spellCheck={false} autoComplete="off" autoCapitalize="none" aria-describedby={`${fieldId}-hint`} aria-invalid={!!error} onChange={event => {
      revision.current++; setCandidate(undefined); setError(''); setBusy(false);
      const value = event.target.value;
      onChange(value, value.trim().startsWith('st:eth:') ? value.trim() : '');
    }} placeholder={store.mode === 'testnet' ? 'your-name.eth' : 'your-name.eth or st:eth:0x…'} /><Button variant="secondary" icon={Search} busy={busy} disabled={!destination.trim()} onClick={() => void check()}>Check</Button></div>
    <p className="field-hint" id={`${fieldId}-hint`}>{store.mode === 'testnet' ? 'Required for every recipient. Their Sepolia ENS name must resolve to a linked SQL Payment ID.' : 'Sepolia names or SQL Payment IDs only. No wallet addresses.'}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {candidate && <div className={`name-resolution ${changed ? 'name-resolution-changed' : ''}`} role="status">
      <strong>{changed ? 'Payment destination changed' : 'Confirm recipient'}</strong><p><bdi>{candidate.name}</bdi></p>
      {changed ? <p>The owner, resolver or Payment ID changed. Verify with the recipient before continuing.</p> : <p>Is this the name your recipient shared?</p>}
      <details><summary>View Payment ID</summary>{previous && <label className="field">Previously checked<textarea readOnly rows={3} value={previous.profile} /></label>}<label className="field">Current Payment ID<textarea readOnly rows={3} value={candidate.profile} /></label><p className="field-hint">Fingerprint: <code>{candidate.fingerprint}</code></p></details>
      <Button variant="secondary" icon={Check} onClick={() => { onChange(candidate.name, candidate.profile, candidate); store.rememberPaymentName(candidate); setCandidate(undefined); }}>{changed ? 'I confirmed this change' : 'Use this ENS name'}</Button>
    </div>}
    {!candidate && row.paymentName && <p className="name-checked" role="status"><Check size={14} /> <bdi>{row.paymentName.name}</bdi> · Payment ID checked</p>}
  </div>;
}
