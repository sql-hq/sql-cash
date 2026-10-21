import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function DeveloperCodeBlock({ title, value }: { title: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setError(''); }
    catch { setError('Clipboard unavailable. Select and copy the code below.'); }
  }
  return <div className="developer-code">
    <div className="developer-code-heading"><span>{title}</span><button type="button" onClick={() => void copy()} aria-label={`Copy ${title}`}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy'}</button></div>
    <pre tabIndex={0} aria-label={title}><code>{value}</code></pre>
    <span className={error ? 'developer-copy-error' : 'sr-only'} role="status">{error || (copied ? 'Copied to clipboard.' : '')}</span>
  </div>;
}
