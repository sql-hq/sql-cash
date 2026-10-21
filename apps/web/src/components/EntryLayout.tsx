import type { ReactNode } from 'react';
import { Logo } from './Logo';

/** Shared first-visit, authentication, and recovery shell. */
export function EntryLayout({ children, action, footer = 'Silent Query Layer · Private payments', className = '' }: {
  children: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return <div className="entry-page">
    <header className="entry-header"><div className="brand entry-brand"><Logo size={32} className="brand-logo" /><span>SQL</span></div>{action}</header>
    <main className={`entry-main ${className}`.trim()} id="main-content">{children}</main>
    <footer className="entry-footer">{footer}</footer>
  </div>;
}
