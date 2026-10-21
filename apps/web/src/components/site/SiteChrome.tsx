import { useEffect, useState } from 'react';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { Logo } from '../Logo';
import './site.css';

export const repository = 'https://github.com/sql-hq';
const xProfile = 'https://x.com/SQL_Cash';

// Section links scroll in place: the app uses hash routes, so "#features" would leave the page.
function goToSection(id: string) {
  if (!window.location.hash.match(/^#\/?(developers)?\/?$/) && window.location.hash !== '') {
    window.location.hash = '#/developers';
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    return;
  }
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const sections = [['about', 'About'], ['features', 'Features'], ['protocol', 'Protocol'], ['developers', 'Developers'], ['faq', 'FAQ']] as const;

export function SiteNav({ current }: { current?: 'docs' }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const pick = (id: string) => { setOpen(false); goToSection(id); };
  return (
    <header className={`site-nav ${scrolled ? 'is-scrolled' : ''} ${open ? 'is-open' : ''}`}>
      <div className="site-wrap site-nav-row">
        <a className="site-brand" href="#/developers" aria-label="Silent Query Layer home" onClick={() => setOpen(false)}>
          <Logo size={22} className="site-brand-mark" />
          <span className="site-brand-name">SQL</span>
          <span className="site-brand-sub">silent query layer</span>
        </a>
        <nav className="site-links" aria-label="Primary">
          {sections.map(([id, label]) => <button key={id} type="button" onClick={() => pick(id)}>{label}</button>)}
          <a href="#/developers/quickstart" aria-current={current === 'docs' ? 'page' : undefined}>Docs</a>
        </nav>
        <div className="site-actions">
          <a className="site-btn site-btn-ghost site-hide-sm" href={repository} target="_blank" rel="noreferrer">GitHub<ArrowUpRight size={14} /></a>
          <a className="site-btn site-btn-ghost site-hide-sm" href={xProfile} target="_blank" rel="noopener noreferrer" aria-label="SQL on X">X<ArrowUpRight size={14} /></a>
          <a className="site-btn site-btn-primary" href="#/app">Launch console</a>
          <button type="button" className="site-menu" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-controls="site-mobile-menu" aria-label={open ? 'Close menu' : 'Open menu'}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      <div id="site-mobile-menu" className="site-mobile" hidden={!open}>
        <div className="site-wrap">
          {sections.map(([id, label], i) => <button key={id} type="button" onClick={() => pick(id)}><span>0{i + 1}</span>{label}</button>)}
          <a href="#/developers/quickstart" onClick={() => setOpen(false)}><span>06</span>Docs</a>
          <a href={repository} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}><span>07</span>GitHub</a>
          <a href={xProfile} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}><span>08</span>X · @SQL_Cash</a>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-wrap">
        <div className="site-footer-grid">
          <div className="site-footer-brand">
            <a className="site-brand" href="#/developers"><Logo size={26} className="site-brand-mark" /><span className="site-brand-name">SQL</span></a>
            <p>Private payout infrastructure for Ethereum. Pay a team by ENS name; the chain never sees the roster.</p>
          </div>
          <nav aria-label="Product"><h3>Product</h3><a href="#/app">Mainnet console</a><a href="#/protocol">Connection status</a><button type="button" onClick={() => goToSection('features')}>Features</button></nav>
          <nav aria-label="Developers"><h3>Developers</h3><a href="#/developers/quickstart">Quickstart</a><a href="#/developers/api">API reference</a><a href="#/developers/ai">AI skill</a><a href={repository} target="_blank" rel="noreferrer">GitHub</a><a href={xProfile} target="_blank" rel="noopener noreferrer">X · @SQL_Cash</a></nav>
          <nav aria-label="Protocol"><h3>Protocol</h3><a href="#/developers/privacy">Privacy boundaries</a><button type="button" onClick={() => goToSection('protocol')}>How it works</button><button type="button" onClick={() => goToSection('faq')}>FAQ</button></nav>
        </div>
        <div className="site-footer-bar">
          <span><i className="site-dot" aria-hidden /> SYS NOMINAL · ETHEREUM MAINNET · RAILGUN</span>
          <span>MIT · Unaudited prototype · Test funds only</span>
        </div>
      </div>
    </footer>
  );
}
