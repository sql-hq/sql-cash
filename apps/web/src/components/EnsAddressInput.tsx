import { useEffect, useId, useRef, useState } from 'react';
import { getAddress, isAddress, zeroAddress } from 'viem';
import { resolveEnsAddress, type EnsAddress } from '../lib/ens-identity';
import { ensClient } from '../lib/ens';
import { Button, CopyButton } from './ui';

export function EnsAddressInput({ label, disabled, allowAddress = false, addressHelp = 'Recovery and withdrawals remain available if a name expires or cannot be resolved.', onChange }: { label: string; disabled?: boolean; allowAddress?: boolean; addressHelp?: string; onChange: (address: string, name?: EnsAddress) => void }) {
  const id = useId(); const revision = useRef(0);
  const [input, setInput] = useState(''); const [raw, setRaw] = useState(false);
  const [result, setResult] = useState<EnsAddress>(); const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => () => { revision.current++; }, []);
  function change(value: string) {
    revision.current++; setInput(value); setResult(undefined); setConfirmed(false); setError(''); setBusy(false);
    onChange(raw && isAddress(value) && value !== zeroAddress ? getAddress(value) : '');
  }
  async function check() {
    const version = ++revision.current; setBusy(true); setError(''); setResult(undefined); setConfirmed(false); onChange('');
    try { const found = await resolveEnsAddress(ensClient, input); if (version === revision.current) setResult(found); }
    catch (reason) { if (version === revision.current) setError(reason instanceof Error ? reason.message : 'Could not check this ENS name. Try again.'); }
    finally { if (version === revision.current) setBusy(false); }
  }
  return <div className="ens-address-input">
    <label className="field" htmlFor={id}>{raw ? `${label} address` : `${label} ENS name`}</label>
    <div className="name-input-row"><input id={id} value={input} maxLength={raw ? 42 : 512} disabled={disabled} onChange={event => change(event.target.value.trim())} placeholder={raw ? '0x…' : 'your-name.eth'} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby={`${id}-hint`} aria-invalid={!!error} />{!raw && <Button variant="secondary" busy={busy} disabled={disabled || !input.trim()} onClick={() => void check()}>Check name</Button>}</div>
    <p className="field-hint" id={`${id}-hint`}>{raw ? 'Use this only when a receiving wallet has no ENS name. Check the complete address before confirming.' : 'Uses the name’s ETH address on Sepolia. A SQL Payment ID is a separate record.'}</p>
    {result && <div className="name-resolution" role="status"><strong><bdi>{result.name}</bdi></strong><p>{confirmed ? 'Destination confirmed. We’ll check it again before sending.' : 'Check this name and its receiving wallet before using it.'}</p><details className="ens-identity-details"><summary>Receiving wallet details</summary><span className="code-with-copy"><code>{result.address}</code><CopyButton value={result.address} /></span></details>{!confirmed && <Button variant="secondary" disabled={disabled} onClick={() => { setConfirmed(true); onChange(result.address, result); }}>Use this ENS name</Button>}</div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {allowAddress && <details className="progressive-details"><summary>Wallet without an ENS name</summary><p>{addressHelp}</p><label className="checkbox-field"><input type="checkbox" checked={raw} disabled={disabled || busy} onChange={event => { revision.current++; setRaw(event.target.checked); setInput(''); setResult(undefined); setConfirmed(false); setError(''); onChange(''); }} /><span>Enter a wallet address manually</span></label></details>}
  </div>;
}
