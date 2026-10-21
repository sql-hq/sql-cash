import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { EvmSender, OriginWithdrawalQuote, VaultRecord } from '@silentquery/railgun/engine';
import { afterFee, formatUsdc } from '@silentquery/railgun';
import { config } from '../lib/config';
import { assertTransactionsEnabled, safeMainnetError } from '../lib/mainnet-safety';
import { txUrl } from '../lib/railgun-runtime';
import { Button } from './ui';

type Props = {
  engine: typeof import('@silentquery/railgun/engine') | null;
  record: VaultRecord | null;
  encryptionKey: string | null;
  synchronized: boolean;
  getSender: () => Promise<EvmSender>;
  onComplete: () => void;
};
export function OriginWithdrawal({ engine, record, encryptionKey, synchronized, getSender, onComplete }: Props) {
  const [deposit, setDeposit] = useState(''), [quote, setQuote] = useState<OriginWithdrawalQuote | null>(null);
  const [reviewed, setReviewed] = useState(false), [stage, setStage] = useState('');
  const [error, setError] = useState(''), [hash, setHash] = useState('');
  const version = useRef(0), submitting = useRef(false);
  useEffect(() => {
    version.current++; submitting.current = false;
    setQuote(null); setReviewed(false); setStage(''); setError(''); setHash('');
    return () => { version.current++; };
  }, [record?.walletId, encryptionKey]);
  const valid = /^0x[0-9a-f]{64}$/i.test(deposit);
  const check = async () => {
    if (!engine || !record || !valid || !synchronized || submitting.current) return;
    const request = ++version.current; submitting.current = true;
    setStage('Checking deposit'); setError(''); setQuote(null); setReviewed(false); setHash('');
    try {
      const next = await engine.originWithdrawalQuote(record, deposit);
      if (request === version.current) setQuote(next);
    } catch {
      if (request === version.current) setError('No returnable USDC could be confirmed. Check the original deposit hash, vault synchronization, and connection.');
    } finally {
      if (request === version.current) { submitting.current = false; setStage(''); }
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!engine || !record || !encryptionKey || !quote || !reviewed || !synchronized || submitting.current) return;
    const request = ++version.current; submitting.current = true;
    setStage('Preparing return'); setError(''); setHash('');
    try {
      assertTransactionsEnabled(config.mainnetTransactionsEnabled);
      const result = await engine.unshieldToOriginUsdc(await getSender(), record, encryptionKey, quote, step => {
        if (request === version.current) setStage(step === 'prove' ? 'Generating withdrawal proof' : step === 'submit' ? 'Confirm in your wallet' : 'Estimating network fee');
      });
      if (request === version.current) { setHash(result); setQuote(null); setReviewed(false); onComplete(); }
    } catch (reason) {
      if (request === version.current) setError(safeMainnetError(reason));
    } finally {
      if (request === version.current) { submitting.current = false; setStage(''); }
    }
  };
  return <section className="rg-panel" aria-labelledby="origin-return-title">
    <h2 id="origin-return-title">Return a pending deposit</h2>
    <p className="rg-note" id="origin-return-help">New deposits normally have a one-hour PPOI standby period before private payments. You can return an unspent USDC-only deposit to its original funding address without waiting. This return is not private.</p>
    <form className="rg-form" onSubmit={event => void submit(event)}>
      <label className="field"><span>Original Ethereum deposit transaction hash</span>
        <input value={deposit} onChange={event => { version.current++; setDeposit(event.target.value.trim()); setQuote(null); setReviewed(false); setError(''); setHash(''); }}
          disabled={!!stage} placeholder="0x…" spellCheck={false} autoComplete="off" maxLength={66} aria-describedby="origin-return-help" />
      </label>
      <div className="button-row"><Button type="button" variant="secondary" disabled={!!stage || !valid || !synchronized} onClick={() => void check()}>Check returnable deposit</Button></div>
      {quote && <>
        <div className="rg-note" role="status">
          <p style={{ overflowWrap: 'anywhere' }}>Original funding address: {quote.to}</p>
          <p>Returnable: {formatUsdc(quote.amount)} USDC · estimated received after protocol fee: {formatUsdc(afterFee(quote.amount))} USDC.</p>
        </div>
        <label className="rg-check"><input type="checkbox" checked={reviewed} disabled={!!stage} onChange={event => setReviewed(event.target.checked)} /> I checked the original funding address, amount, protocol fee and ETH network fee.</label>
        <div className="button-row"><Button type="submit" disabled={!!stage || !reviewed || !synchronized || !config.mainnetTransactionsEnabled}>Return to original wallet</Button></div>
      </>}
      {stage && <p className="rg-note" role="status" aria-live="polite">{stage}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {hash && <p role="status"><a href={txUrl(hash)} target="_blank" rel="noreferrer">Return confirmed — view transaction</a></p>}
    </form>
  </section>;
}
