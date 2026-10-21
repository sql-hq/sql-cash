import { StrictMode, Component, lazy, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Developers } from './pages/Developers';
import { EntryLayout } from './components/EntryLayout';
import { canonicalPublicHash } from './lib/public-routes';
import '@fontsource/vt323/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import '@fontsource/share-tech-mono/latin-400.css';
import './styles.css';
import './soft-outline.css';
import './payment-flow.css';
import './theme-terminal.css';
import { startScramble } from './lib/scramble';

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Deliberately no telemetry or secret-bearing error logs. */ }
  render() { return this.state.failed ? <EntryLayout><h1>We couldn’t open your workspace.</h1><p className="entry-description" role="alert">Reload to try again. Unsaved work will be lost. Any backup files you saved will stay on your device.</p><button className="button button-primary entry-continue" onClick={() => window.location.reload()}>Reload workspace</button></EntryLayout> : this.props.children; }
}
const ReferenceApp = lazy(() => import('./ReferenceApp'));
function Root() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => { const onHash = () => setHash(window.location.hash); window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash); }, []);
  useEffect(() => {
    const canonical = canonicalPublicHash(hash);
    if (canonical !== hash) { window.history.replaceState(null, '', canonical); setHash(canonical); }
  }, [hash]);
  if (['', '#/'].includes(hash) || hash === '#/developers' || hash.startsWith('#/developers/')) return <Developers />;
  return <Suspense fallback={<EntryLayout><h1>Opening your mainnet workspace</h1><p role="status">Loading the wallet connection…</p></EntryLayout>}><ReferenceApp /></Suspense>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><Root /></ErrorBoundary></StrictMode>);
startScramble();
