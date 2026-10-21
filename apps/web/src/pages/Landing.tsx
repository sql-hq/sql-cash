import { useCallback, useEffect, useRef, useState } from 'react';
import { AsciiMask } from '../components/AsciiMask';
import { ArrowRight, Check, Copy, RotateCcw } from 'lucide-react';
import { SiteFooter, SiteNav } from '../components/site/SiteChrome';
import { Logo } from '../components/Logo';
import { TokenContract } from '../components/site/TokenContract';
import './landing.css';

const install = 'npm i @silentquery/railgun';

type Line = { kind: 'cmd' | 'out' | 'ok'; text: string; tail?: string };
const session: Line[] = [
  { kind: 'cmd', text: 'sql vault shield 25000 USDC' },
  { kind: 'out', text: 'railgun proxy 0xfa70…a4b9', tail: 'mainnet' },
  { kind: 'out', text: 'proof of innocence', tail: 'cleared' },
  { kind: 'cmd', text: 'sql payout send --batch october.csv' },
  { kind: 'out', text: 'resolve 8 ENS → 0zk', tail: '8/8' },
  { kind: 'out', text: 'groth16 transfer proof', tail: '6.2s' },
  { kind: 'out', text: 'recipients · amounts on chain', tail: 'encrypted' },
  { kind: 'out', text: 'block 23,614,077', tail: 'confirmed' },
  { kind: 'cmd', text: 'sql balance --recipient alice.eth' },
  { kind: 'ok', text: '2,400.00 USDC → private balance' },
];

const features = [
  { id: '01', title: 'Vault', body: 'Create a Railgun 0zk vault in the browser, encrypted with your password. Your EVM wallet funds it; SQL never holds keys.',
    items: ['Local 0zk wallet', '12-word recovery', 'Password encryption', 'Import existing wallet'] },
  { id: '02', title: 'Shield', body: 'Move USDC from your wallet into Railgun on Ethereum mainnet. Observers see a deposit, never what happens next.',
    items: ['Railgun mainnet proxy', 'Proof of Innocence', '0.25% protocol fee', 'Your wallet signs'] },
  { id: '03', title: 'Pay', body: 'Pay up to ten ENS names in one private transfer. Recipients and amounts are encrypted; a zero-knowledge proof authorizes it.',
    items: ['ENS → 0zk resolution', 'Groth16 proofs in-browser', 'Encrypted memo', 'One transaction per batch'] },
  { id: '04', title: 'Withdraw', body: 'Recipients keep funds private or unshield any amount to a fresh wallet whenever they choose.',
    items: ['Partial withdrawals', 'Any destination address', 'Private remainder', 'Etherscan receipts'] },
];

const steps = [
  ['Connect', 'Connect an EVM wallet on Ethereum mainnet. It signs and pays gas; it never sees the private balance.'],
  ['Shield', 'Deposit USDC into your Railgun vault. After the Proof of Innocence check it becomes spendable.'],
  ['Resolve', 'ENS names resolve to 0zk addresses through their railgun text record. The payer reviews each one.'],
  ['Send', 'One private transfer pays the batch. The chain sees a Railgun transaction, not recipients or amounts.'],
  ['Withdraw', 'Recipients hold privately or unshield to a fresh wallet when they choose.'],
];

const diagram = String.raw`  ORG ──▶ shield ──┐                ┌───────────────┐            ┌────────────┐
                   │   USDC         │    RAILGUN    │  0zk → 0zk │  alice.eth │──▶ balance
  wallet signs ────┴──────────────▶│   mainnet     │──────────▶ │  bob.eth   │
                    proof of        │  ░░░░░░░░░░░  │  encrypted │  +8 more   │──▶ unshield
                    innocence       └───────────────┘            └────────────┘

  public  ▸ shield · unshield · timing        private ▸ who · how much · balances`;

const snippet = `import { resolveRecipients, parseUsdc } from '@silentquery/railgun';
const rg = await import('@silentquery/railgun/engine');

// 1. ENS names → Railgun 0zk addresses (mainnet)
const { resolved } = await resolveRecipients([
  { name: 'alice.eth', amount: '2400' },
  { name: 'bob.eth',   amount: '1150' },
], readEnsText, rg.isRailgunAddress);

// 2. One private transfer, signed by the user's wallet
await rg.privatePayout(wallet, vault, key, resolved, 'October');`;

const faq = [
  ['What is Silent Query Layer?', 'SQL is a console and TypeScript toolkit for private payouts on Ethereum mainnet. You pay contributors by ENS name through Railgun, and the chain never receives a readable list of who was paid or how much.'],
  ['Is it live on mainnet?', 'Yes. On Ethereum mainnet, SQL moves USDC through Railgun, an audited privacy system live since 2022. The SQL console itself is new and has not had its own independent audit, so start with small amounts.'],
  ['What stays public?', 'The shield deposit, each unshield to a public wallet, their timing, and the fact that your wallet sent a Railgun transaction. Recipients, amounts and private balances stay encrypted.'],
  ['Do recipients need an ENS name?', 'No, but it helps. Payers can paste a 0zk address directly, or a recipient adds their 0zk address as the railgun text record on their ENS name once.'],
  ['Can a recipient withdraw part of a payment?', 'Yes. Unshield any amount to any address; the rest stays in the private balance. Railgun charges 0.25% on unshield.'],
  ['Do my users have to leave my app?', 'No. Use the SDK inside your own screens. The console and reference app are examples of an integration, not a required destination.'],
];

function CopyLine({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); window.setTimeout(() => setDone(false), 1600); }
    catch { const range = document.createRange(); if (ref.current) { range.selectNodeContents(ref.current); const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range); } }
  };
  return <div className="lp-copy"><span aria-hidden>$</span><code ref={ref}>{value}</code>
    <button type="button" onClick={copy} aria-label={label}>{done ? <Check size={15} /> : <Copy size={15} />}</button></div>;
}

function Terminal() {
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [line, setLine] = useState(reduce ? session.length : 0);
  const [chars, setChars] = useState(0);
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (line >= session.length) return;
    const current = session[line];
    const full = current.text.length;
    const speed = current.kind === 'cmd' ? 34 : 9;
    const t = window.setTimeout(() => {
      if (chars < full) setChars(c => c + 1);
      else { setLine(l => l + 1); setChars(0); }
    }, chars < full ? speed : current.kind === 'cmd' ? 380 : 140);
    return () => window.clearTimeout(t);
  }, [line, chars, run]);
  const replay = () => { setLine(0); setChars(0); setRun(r => r + 1); };
  const done = line >= session.length;
  return (
    <div className="lp-term" role="img" aria-label="Terminal session: USDC is shielded into Railgun on mainnet, eight ENS names are paid in one private transfer, and the recipient sees a private balance.">
      <div className="lp-term-bar">
        <span className="lp-term-dots" aria-hidden><i /><i /><i /></span>
        <span className="lp-term-title">sql@mainnet:~/payroll</span>
        <button type="button" onClick={replay} aria-label="Replay terminal session" disabled={!done}><RotateCcw size={13} /></button>
      </div>
      <pre className="lp-term-body" aria-hidden>
        {session.slice(0, Math.min(line + 1, session.length)).map((l, i) => {
          const typing = i === line;
          const text = typing ? l.text.slice(0, chars) : l.text;
          const showTail = !typing && l.tail;
          return <span key={`${run}-${i}`} className={`lp-tl lp-tl-${l.kind}`}>
            {l.kind === 'cmd' ? <b>$ </b> : l.kind === 'ok' ? <b>✓ </b> : <b>› </b>}
            {text}
            {showTail && <><span className="lp-tl-fill">{' '}{'.'.repeat(Math.max(2, 30 - l.text.length))}{' '}</span><em>{l.tail}</em></>}
            {typing && <span className="lp-caret" />}
            {'\n'}
          </span>;
        })}
        {done && <span className="lp-tl lp-tl-cmd"><b>$ </b><span className="lp-caret" /></span>}
      </pre>
    </div>
  );
}

/** Faint HUD crosshair that tracks the pointer inside the hero. */
function useHud(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !window.matchMedia('(pointer: fine)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0, x = 0, y = 0, tx = 0, ty = 0;
    const label = el.querySelector<HTMLElement>('.lp-hero-hud span');
    const tick = () => {
      x += (tx - x) * 0.16; y += (ty - y) * 0.16;
      el.style.setProperty('--hx', `${x.toFixed(1)}px`); el.style.setProperty('--hy', `${y.toFixed(1)}px`);
      if (label) label.textContent = `X ${String(Math.round(x)).padStart(4, '0')}  Y ${String(Math.round(y)).padStart(4, '0')}`;
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.4 ? requestAnimationFrame(tick) : 0;
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect(); tx = e.clientX - r.left; ty = e.clientY - r.top;
      if (!el.classList.contains('hud-on')) { x = tx; y = ty; el.classList.add('hud-on'); }
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const leave = () => el.classList.remove('hud-on');
    el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave);
    return () => { cancelAnimationFrame(raf); el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
  }, [ref]);
}

/** Sections fade up once as they enter the viewport. */
function useReveal() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    const els = [...document.querySelectorAll<HTMLElement>('.lp [data-reveal]')];
    const io = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    els.forEach(el => { if (el.getBoundingClientRect().top > window.innerHeight) { el.classList.add('will-reveal'); io.observe(el); } });
    return () => io.disconnect();
  }, []);
}

// Logo rects (from Logo.tsx viewBox 266 304 724 724), sampled into an ASCII bitmap for the BIOS panel.
const LOGO_RECTS = [[434,312,81,83],[739,312,80,83],[343,404,91,246],[819,404,92,244],[271,640,78,82],[906,640,78,82],[344,722,91,216],[819,722,92,216],[436,940,77,76],[741,940,77,76],[514,490,75,75],[665,490,75,75],[509,639,235,83]];

type BiosTab = 'summary' | 'cases' | 'boot' | 'seq';
const biosTabs: [BiosTab, string][] = [['summary', 'Summary'], ['cases', 'Cases'], ['boot', 'Boot'], ['seq', 'Seq']];
const biosText: Record<BiosTab, string> = {
  summary: `@ECHO OFF
MODE CON: COLS=80 LINES=30
TITLE SQL // SILENT QUERY LAYER

:: ABOUT ============================================
ECHO SQL IS PRIVATE PAYOUT INFRASTRUCTURE FOR
ECHO ETHEREUM. TEAMS PAY PEOPLE BY ENS NAME AND
ECHO THE CHAIN NEVER RECEIVES A READABLE ROSTER.
ECHO
ECHO FUNDS MOVE THROUGH RAILGUN ON ETHEREUM
ECHO MAINNET. EVERY TRANSFER IS ENCRYPTED AND
ECHO AUTHORIZED BY A ZERO-KNOWLEDGE PROOF.
ECHO
:: WHAT STAYS PUBLIC ================================
ECHO [+] THE SHIELD DEPOSIT   [+] EACH UNSHIELD
ECHO [+] TIMING               [+] ENS RECORDS
:: WHAT STAYS PRIVATE ===============================
ECHO [-] WHO WAS PAID         [-] HOW MUCH
ECHO [-] PRIVATE BALANCES
ECHO
ECHO KEYS STAY WITH THEIR OWNERS. SQL NEVER HOLDS
ECHO FUNDS OR SECRETS.`,
  cases: `:: CASE FILES =======================================

CASE 01 // DAO CONTRIBUTOR PAYROLL
ECHO PROBLEM : EVERY PAYOUT PUBLISHES WHO EARNS WHAT.
ECHO WITH SQL: ONE TREASURY DEPOSIT, PAID BY ENS NAME.
ECHO           THE ROSTER NEVER TOUCHES THE CHAIN.

CASE 02 // GRANTS & BOUNTIES
ECHO PROBLEM : PUBLIC AMOUNTS INVITE PRESSURE AND
ECHO           TARGETING OF RECIPIENTS.
ECHO WITH SQL: MILESTONES PAID AS PRIVATE TRANSFERS;
ECHO           RECIPIENTS UNSHIELD WHEN THEY CHOOSE.

CASE 03 // STABLECOIN SALARIES
ECHO PROBLEM : SALARIES AND WALLETS BECOME LINKABLE.
ECHO WITH SQL: SALARIES LAND IN A 0ZK BALANCE;
ECHO           EXIT TO A FRESH WALLET, KEEP THE
ECHO           REST PRIVATE.`,
  boot: `:: BOOT SEQUENCE ====================================
ECHO [1] CONNECT EVM WALLET (MAINNET) .. REQUIRED
ECHO [2] CREATE 0ZK VAULT .............. ONCE
ECHO [3] SAVE RECOVERY PHRASE .......... ALWAYS
ECHO [4] OPEN CONSOLE .................. READY
ECHO
SET /P SELECTION=SELECT AN OPTION [1-4]:
IF "%SELECTION%"=="1" GOTO WALLET
IF "%SELECTION%"=="4" GOTO CONSOLE
ECHO
ECHO NOTE: EMAIL SIGN-IN ALONE CANNOT MOVE FUNDS.
ECHO       EVERY SHIELD, TRANSFER AND UNSHIELD IS
ECHO       SIGNED BY YOUR OWN WALLET.`,
  seq: `:: PAYOUT SEQUENCE ==================================
ECHO 01 CONNECT ...... EVM WALLET ON CHAIN 1
ECHO 02 VAULT ........ 0ZK WALLET, LOCAL + ENCRYPTED
ECHO 03 SHIELD ....... USDC -> RAILGUN (0.25%)
ECHO 04 CLEAR ........ PROOF OF INNOCENCE (~1H)
ECHO 05 RESOLVE ...... ENS -> 0ZK (RAILGUN RECORD)
ECHO 06 SEND ......... GROTH16 PROOF, 1 TRANSFER
ECHO 07 WITHDRAW ..... UNSHIELD ANY AMOUNT
ECHO
ECHO STATUS: MAINNET // RAILGUN AUDITED, CONSOLE NEW`,
};

function BiosCard() {
  const [tab, setTab] = useState<BiosTab>('summary');
  return <article className="bios" data-reveal aria-label="About SQL">
    <div className="bios-meta"><span>SQL BIOS (TM)</span><span>COPYRIGHT SILENT QUERY LAYER 2026</span><span className="bios-hide-sm">PRIVACY</span><span className="bios-hide-sm">VER V0.3</span><span>CHAIN.....1</span></div>
    <div className="bios-tabs" role="tablist" aria-label="About SQL">
      {biosTabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      <a href="#/developers/quickstart" className="bios-more">More+</a>
    </div>
    <div className="bios-main">
      <pre className="bios-log" role="tabpanel" tabIndex={0}>{biosText[tab]}</pre>
      <div className="bios-art bios-art-canvas" aria-hidden><AsciiMask className="bios-canvas" /></div>
    </div>
    <div className="bios-bottom">
      <pre className="bios-script">{`@ECHO OFF
TITLE SQL-BIOS
MODE CON: COLS=80
:: SQL BOOT SCREEN
ECHO | SEAL IT. SETTLE IT.
ECHO | PROVE IT. EXIT CLEAN.
ECHO | NOTHING READABLE ON CHAIN.`}</pre>
      <div className="bios-banks">
        <div><span>BANK 1</span><b>SEALED</b><b>SHIELDED</b><b>PROVEN</b></div>
        <div><span>BANK 2</span><b>ENS</b><b>NOIR</b><b>ETH</b></div>
      </div>
      <pre className="bios-box">{`BANK 1 : 8 SLOTS / BATCH
BANK 2 : 5 ZK CIRCUITS
PING LOCALHOST -N 1 >NUL
ECHO 0 PLAINTEXT ROWS`}</pre>
    </div>
    <div className="bios-word bios-marquee" aria-hidden><div className="bios-marquee-track">{[0, 1].map(k => <span key={k}>SILENT QUERY LAYER<i>◆</i>SILENT QUERY LAYER<i>◆</i></span>)}</div></div>
  </article>;
}

function SectionHead({ index, label, title, children, link }: { index: string; label: string; title: string; children?: React.ReactNode; link?: [string, string] }) {
  return <div className="lp-head" data-reveal>
    <div className="lp-index"><span>[/&gt; {index}</span>{link && <a href={link[1]}>{link[0]} →</a>}</div>
    <p className="lp-mark"><span aria-hidden>░░░</span> {label} <span aria-hidden>░░░</span></p>
    <h2>{title}</h2>
    {children && <p className="lp-lead">{children}</p>}
  </div>;
}

const keys: [string, string, string][] = [
  ['H', 'Home', 'top'], ['A', 'About', 'about'], ['F', 'Features', 'features'], ['P', 'Protocol', 'protocol'],
  ['D', 'Developers', 'developers'], ['Q', 'FAQ', 'faq'],
];

/** nano-style key bar. Plain letter keys jump to sections when no field has focus; I inverts the page. */
function KeyBar({ inverted, onInvert }: { inverted: boolean; onInvert: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const k = e.key.toUpperCase();
      if (k === 'I') { onInvert(); return; }
      if (k === 'U') { window.scrollBy({ top: -window.innerHeight * .85, behavior: 'smooth' }); return; }
      if (k === 'N') { window.scrollBy({ top: window.innerHeight * .85, behavior: 'smooth' }); return; }
      const hit = keys.find(([key]) => key === k);
      if (!hit) return;
      if (hit[2] === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
      else document.getElementById(hit[2])?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onInvert]);
  const go = (id: string) => id === 'top' ? window.scrollTo({ top: 0, behavior: 'smooth' }) : document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return <nav className="lp-keys" aria-label="Keyboard shortcuts">
    {keys.map(([k, label, id]) => <button key={k} type="button" onClick={() => go(id)}><kbd>{k}</kbd>{label}</button>)}
    <button type="button" onClick={() => window.scrollBy({ top: -window.innerHeight * .85, behavior: 'smooth' })}><kbd>U</kbd>Page up</button>
    <button type="button" onClick={() => window.scrollBy({ top: window.innerHeight * .85, behavior: 'smooth' })}><kbd>N</kbd>Page down</button>
    <button type="button" onClick={onInvert} aria-pressed={inverted}><kbd>I</kbd>Invert</button>
  </nav>;
}

export function Landing() {
  const hero = useRef<HTMLElement>(null);
  useHud(hero);
  useReveal();
  const [inverted, setInverted] = useState(() => { try { return localStorage.getItem('sql-invert') === '1'; } catch { return false; } });
  const toggleInvert = useCallback(() => setInverted(v => { const n = !v; try { localStorage.setItem('sql-invert', n ? '1' : '0'); } catch { /* storage unavailable */ } return n; }), []);
  useEffect(() => { document.title = 'Silent Query Layer — Private payouts on Ethereum'; }, []);
  return (
    <div className={`lp site ${inverted ? 'lp-invert' : ''}`}>
      <a className="skip-link" href="#main" onClick={e => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <SiteNav />
      <main id="main" tabIndex={-1}>
        <section className="lp-hero" ref={hero} aria-labelledby="hero-title">
          <div className="lp-hero-hud" aria-hidden><span /></div>
          <div className="site-wrap lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="lp-status"><i className="site-dot" aria-hidden />SYS ONLINE<span>·</span>MAINNET<span className="lp-status-x">· RAILGUN</span></p>
              <h1 id="hero-title" className="lp-hero-title">Private payouts.<br /><span>Zero plaintext.</span></h1>
              <p className="lp-hero-sub">Pay your whole team by ENS name on Ethereum mainnet. SQL routes every payout through Railgun, so recipients and amounts are encrypted and each transfer is authorized by a zero-knowledge proof.</p>
              <div className="lp-hero-ctas">
                <a className="site-btn site-btn-primary site-btn-lg" href="#/app">Launch console<ArrowRight size={16} /></a>
                <a className="site-btn site-btn-ghost site-btn-lg" href="#/developers/quickstart">Read the docs</a>
              </div>
              <CopyLine value={install} label="Copy install command" />
              <TokenContract />
            </div>
            <Terminal />
          </div>
          <div className="site-wrap">
            <dl className="lp-stats" data-reveal>
              {[['01', 'chain · Ethereum mainnet'], ['10', 'recipients per transfer'], ['00', 'plaintext rows on chain'], ['00', 'keys held by SQL']].map(([n, l]) => <div key={l}><dt>{n}</dt><dd>{l}</dd></div>)}
            </dl>
          </div>
        </section>

        <section className="lp-section" id="about" aria-labelledby="about-title">
          <div className="site-wrap">
            <SectionHead index="01" label="About" link={['Console', '#/app']} title="Boot the protocol">What SQL is, the cases it was built for, and how a payout runs. Switch tabs to read each file.</SectionHead>
            <BiosCard />
          </div>
        </section>

        <section className="lp-section" id="features" aria-labelledby="features-title">
          <div className="site-wrap">
            <SectionHead index="02" label="Features" title="Four steps. Nothing readable on chain.">Every payout moves through Railgun on mainnet, from the payer’s wallet to the recipient’s private balance.</SectionHead>
            <div className="lp-features">
              {features.map(f => <article key={f.id} className="lp-card" data-reveal>
                <header><span className="lp-card-id">{f.id}</span><h3>{f.title}</h3></header>
                <p>{f.body}</p>
                <ul>{f.items.map(i => <li key={i}>{i}</li>)}</ul>
              </article>)}
            </div>
          </div>
        </section>

        <section className="lp-section lp-section-alt" id="protocol" aria-labelledby="protocol-title">
          <div className="site-wrap">
            <SectionHead index="03" label="Protocol" title="How a batch moves">The organization shields once, then pays privately. Only shields and withdrawals touch public addresses.</SectionHead>
            <div className="lp-diagram" data-reveal>
              <div className="lp-panel-bar"><span>flow.txt</span><span>1 shield · 1 transfer · n recipients</span></div>
              <pre tabIndex={0} aria-label="Diagram: an organization shields USDC into Railgun on mainnet, then sends one encrypted transfer to each ENS name's 0zk address; recipients keep a private balance or unshield. Public: shield, unshield and timing. Private: who, how much and which batch.">{diagram}</pre>
            </div>
            <ol className="lp-steps">
              {steps.map(([t, d], i) => <li key={t} data-reveal><span className="lp-step-n">{String(i + 1).padStart(2, '0')}</span><div><h3>{t}</h3><p>{d}</p></div></li>)}
            </ol>
          </div>
        </section>

        <section className="lp-section" id="developers" aria-labelledby="developers-title">
          <div className="site-wrap lp-dev">
            <div>
              <SectionHead index="04" label="Developers" link={['Docs', '#/developers/quickstart']} title="One package. Your interface.">Install the TypeScript SDK, bring your own wallet connection, and keep users inside your product.</SectionHead>
              <ul className="lp-checks" data-reveal>
                <li>Framework-independent core packages</li>
                <li>Browser proving in a Web Worker</li>
                <li>Encrypted local recovery and checkpoints</li>
                <li>Optional sponsored gas through your backend</li>
              </ul>
              <div className="lp-dev-links" data-reveal>
                <a className="site-btn site-btn-ghost" href="#/developers/quickstart">Quickstart</a>
                <a className="site-btn site-btn-ghost" href="#/developers/api">API reference</a>
              </div>
            </div>
            <div className="lp-code" data-reveal>
              <div className="lp-panel-bar"><span>payout.ts</span><span>TypeScript</span></div>
              <pre tabIndex={0}><code>{snippet}</code></pre>
            </div>
          </div>
        </section>

        <section className="lp-section" aria-labelledby="cta-title">
          <div className="site-wrap">
            <div className="lp-cta" data-reveal>
              <div>
                <p className="lp-eyebrow"><span>[&gt;_]</span>Get started</p>
                <h2 id="cta-title">Ship private payroll inside your app.</h2>
                <p className="lp-lead">Connect your wallet to manage private USDC on Ethereum mainnet, or integrate the Railgun SDK into your own application.</p>
              </div>
              <div className="lp-cta-actions">
                <a className="site-btn site-btn-primary site-btn-lg" href="#/app">Launch console<ArrowRight size={16} /></a>
                <a className="site-btn site-btn-ghost site-btn-lg" href="#/app">Open mainnet app</a>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-section lp-section-alt" id="faq" aria-labelledby="faq-title">
          <div className="site-wrap lp-faq-wrap">
            <SectionHead index="05" label="FAQ" title="Questions, answered" />
            <div className="lp-faq">
              {faq.map(([q, a], i) => <details key={q} data-reveal open={i === 0}>
                <summary><span className="lp-faq-n">{String(i + 1).padStart(2, '0')}</span>{q}<span className="lp-faq-more" aria-hidden><i className="lp-more">Read more</i><i className="lp-less">Read less</i> ■ ⏎</span></summary>
                <p>{a}</p>
              </details>)}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
      <KeyBar inverted={inverted} onInvert={toggleInvert} />
    </div>
  );
}
