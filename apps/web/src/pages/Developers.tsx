import { useEffect, useState } from 'react';
import { SiteFooter, SiteNav } from '../components/site/SiteChrome';
import { DeveloperDocs } from './DeveloperDocs';
import { Landing } from './Landing';
import './developers.css';

export function Developers() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => { const change = () => setHash(window.location.hash); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  const route = hash.startsWith('#/developers/') ? hash.split('/')[2] : undefined;
  if (!route) return <Landing />;
  return <div className="site docs-page">
    <a className="skip-link" href="#developer-content" onClick={event => { event.preventDefault(); document.getElementById('developer-content')?.focus(); }}>Skip to content</a>
    <SiteNav current="docs" />
    <div className="site-wrap"><DeveloperDocs route={route} /></div>
    <SiteFooter />
  </div>;
}
