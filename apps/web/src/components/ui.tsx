import { useLayoutEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useSession } from '../lib/session';
import { ArrowUpRight, Check, ChevronRight, CircleHelp, Copy, LoaderCircle, ShieldCheck, X, type LucideIcon } from 'lucide-react';

export function Button({ variant = 'primary', icon: Icon, children, className = '', busy, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: LucideIcon; busy?: boolean }) {
  return <button {...props} disabled={props.disabled || busy} className={`button button-${variant} ${className}`} aria-busy={busy || undefined}>{busy ? <LoaderCircle size={16} className="spin" /> : Icon ? <Icon size={16} /> : null}{children}</button>;
}
export function Badge({ children, tone = 'neutral', dot = false }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'purple'; dot?: boolean }) {
  return <span className={`badge badge-${tone}`}>{dot && <span className="badge-dot" />}{children}</span>;
}
export function PageHeader({ title, description, action, breadcrumb }: { title: string; description?: string; action?: ReactNode; breadcrumb?: string }) {
  return <header className="page-heading">{breadcrumb && <p className="breadcrumb">{breadcrumb}<ChevronRight size={13} /><span>{title}</span></p>}<div className="heading-row"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="heading-action">{action}</div>}</div></header>;
}
export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={24} strokeWidth={1.5} /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function Notice({ children, tone = 'info', icon: Icon = ShieldCheck }: { children: ReactNode; tone?: 'info' | 'warning' | 'success'; icon?: LucideIcon }) {
  return <div className={`notice notice-${tone}`}><Icon size={18} /><div>{children}</div></div>;
}
export function Modal({ title, description, open, onClose, children, wide = false, className = '' }: { title: string; description?: string; open: boolean; onClose: () => void; children: ReactNode; wide?: boolean; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { walletModalOpen = false } = useSession();
  const titleId = useId(); const descriptionId = useId();
  // A native modal makes portals elsewhere in the document inert, regardless of
  // z-index. Yield the top layer to Privy without unmounting the in-progress form.
  useLayoutEffect(() => {
    if (open && !walletModalOpen && !dialog.current?.open) {
      dialog.current?.showModal();
      // Browsers may focus a scroll container before its controls. Keep the
      // previous close-button default when no field received autofocus.
      if (document.activeElement === dialog.current?.firstElementChild) {
        dialog.current?.querySelector<HTMLButtonElement>('.modal-heading button')?.focus({ preventScroll: true });
      }
    } else if ((!open || walletModalOpen) && dialog.current?.open) dialog.current.close();
  }, [open, walletModalOpen]);
  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} className={`modal ${wide ? 'modal-wide' : ''} ${className}`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <div className="modal-scroll" tabIndex={-1}>
      <div className="modal-heading"><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20} /></button></div>
      {children}
    </div>
  </dialog>;
}
export function CopyButton({ value, onCopy }: { value: string; onCopy?: () => void }) {
  return <button className="icon-button" title="Copy public value" aria-label="Copy public value" onClick={async () => { try { await navigator.clipboard.writeText(value); onCopy?.(); } catch { /* Selection is available even when clipboard permission is denied. */ } }}><Copy size={14} /></button>;
}
export function KeyValue({ label, children }: { label: string; children: ReactNode }) { return <div className="key-value"><span>{label}</span><strong>{children}</strong></div>; }
export function SectionTitle({ title, action, caption }: { title: string; action?: ReactNode; caption?: string }) { return <div className="section-title"><div><h2>{title}</h2>{caption && <p>{caption}</p>}</div>{action}</div>; }
export function CheckItem({ children, description }: { children: ReactNode; description?: string }) { return <div className="check-item"><Check size={16} /><div><strong>{children}</strong>{description && <p>{description}</p>}</div></div>; }
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) { return <a className="text-link" href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={14} /></a>; }
export function HelpText({ children }: { children: ReactNode }) { return <p className="help-text"><CircleHelp size={14} />{children}</p>; }
