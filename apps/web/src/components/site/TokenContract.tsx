import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import './token-contract.css';

export const SQL_TOKEN_CONTRACT = '0x5081b481aa5F27050588Eab2F10d88fF45302afE';

export function TokenContract() {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SQL_TOKEN_CONTRACT);
      setCopied(true); setFailed(false);
    } catch {
      setCopied(false); setFailed(true);
    }
  };
  return <section className="lp-token-contract" aria-label="$SQL token contract">
    <div className="lp-token-contract-head">
      <div className="lp-token-contract-label"><strong>$SQL</strong><span>Contract address</span></div>
      <button type="button" className="lp-token-copy" onClick={() => void copy()} aria-label="Copy $SQL contract address">
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
    <code className="lp-token-contract-address">{SQL_TOKEN_CONTRACT}</code>
    <span className="lp-token-copy-status" role="status" aria-live="polite">{copied ? 'Contract address copied.' : ''}</span>
    {failed && <p className="lp-token-copy-error" role="alert">Clipboard unavailable. Select the address above to copy it.</p>}
  </section>;
}
