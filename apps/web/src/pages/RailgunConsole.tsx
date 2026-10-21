// Mainnet fund screens backed by Railgun: private vault, private payouts and receiving.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Check, Copy, KeyRound, Lock, Plus, RefreshCw, Send, ShieldCheck, Trash2, Unlock } from 'lucide-react';
import type { EIP1193Provider } from 'viem';
import { USDC, RAILGUN_FEE_BPS, MAX_RECIPIENTS, ENS_RAILGUN_RECORD, afterFee, formatUsdc, parseUsdc, railgunFee, resolveRecipients, type PayoutRow, type RecipientIssue, type ResolvedRow } from '@silentquery/railgun';
import { Button, Notice, PageHeader } from '../components/ui';
import { useEvmWallet, short } from '../components/WalletGate';
import { evmSender, loadEngine, onScan, publicUsdcBalance, readEnsText, saveVault, storedVault, legacyVault, txUrl, type VaultRecord } from '../lib/railgun-runtime';
import { useSession } from '../lib/session';
import { useStore } from '../lib/store';
import { config } from '../lib/config';
import { currentVaultSession, lockPrivateVault, subscribeVault, unlockPrivateVault, vaultContext, vaultStorageKey, vaultVersion, vaultCleanupError } from '../lib/vault-safety';
import { decryptVaultBackup, downloadVaultBackup, encryptVaultBackup, parseVaultBackup, type VaultBackup } from '../lib/vault-backup';
import { assertTransactionsEnabled, safeMainnetError } from '../lib/mainnet-safety';
import { MainnetSafety } from '../components/MainnetSafety';
import { VaultHistory } from '../components/VaultHistory';
import { OriginWithdrawal } from '../components/OriginWithdrawal';

type Balances = { total: bigint; spendable: bigint; pending: bigint };
type Engine = Awaited<ReturnType<typeof loadEngine>>;

function useVault() {
  const { userId } = useSession(); const owner = userId ?? '';
  const version = useSyncExternalStore(subscribeVault, vaultVersion);
  const initial = useMemo(() => { try { return { record: storedVault(owner), error: '' }; } catch (e) { return { record: null, error: safeMainnetError(e) }; } }, [owner]);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [loadError, setLoadError] = useState(initial.error), [attempt, setAttempt] = useState(0);
  const [record, setRecord] = useState<VaultRecord | null>(initial.record);
  const key = currentVaultSession(owner)?.key ?? null;
  const [balances, setBalances] = useState<Balances | null>(null);
  const [syncError, setSyncError] = useState(''), [syncVersion, setSyncVersion] = useState(-1);
  const [scan, setScan] = useState<number | null>(null);
  const [scanPhase, setScanPhase] = useState<'notes' | 'proofs'>('notes');
  useEffect(() => {
    let live = true;
    loadEngine().then(e => { if (live) setEngine(e); }).catch(() => live && setLoadError('The Railgun connection could not start. Check the connection and try again.'));
    const off = onScan((p, status, phase) => {
      if (!live) return;
      if (phase) setScanPhase(phase);
      if (status === 'Incomplete') { setSyncError('History synchronization did not finish. Check the connection and retry.'); setSyncVersion(-1); setScan(null); return; }
      setScan(status === 'Complete' ? null : Math.max(0, Math.min(0.99, p)));
    });
    return () => { live = false; off(); };
  }, [attempt]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === vaultStorageKey(owner)) {
        lockPrivateVault();
        try { setRecord(storedVault(owner)); } catch (e) { setLoadError(safeMainnetError(e)); }
      }
    };
    window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed);
  }, [owner]);
  const refresh = useCallback(async () => {
    if (!engine || !record || !key) return;
    const guard = vaultContext(owner);
    const result = await engine.vaultBalance(record); guard(); setBalances(result);
  }, [engine, record, key, owner]);
  const sync = useCallback(async (full = false) => {
    if (!engine || !record || !key) return;
    const guard = vaultContext(owner); setSyncError(''); setSyncVersion(-1); setScan(0);
    try { await engine.rescan(record, full); guard(); await refresh(); guard(); setSyncVersion(version); setScan(null); }
    catch (error) { try { guard(); setSyncError(safeMainnetError(error)); setScan(null); } catch { /* A different wallet owns the current screen. */ } }
  }, [engine, record, key, owner, version, refresh]);
  useEffect(() => {
    if (!engine || !record || !key) { setBalances(null); return; }
    const off = engine.onBalances(() => { void refresh().catch(() => {}); });
    void sync(); return off;
  }, [engine, record, key, refresh, sync]);
  const unlocked = (r: VaultRecord, k: string) => { saveVault(owner, r); setRecord(r); unlockPrivateVault(owner, r, k); };
  const lock = () => { lockPrivateVault(); setBalances(null); };
  const forget = () => { saveVault(owner, null); lock(); setRecord(null); };
  const recoverLegacy = () => { try { const previous = legacyVault(); if (previous) setRecord(previous); else setLoadError('No previous browser vault was found. Import your recovery backup instead.'); } catch (e) { setLoadError(safeMainnetError(e)); } };
  const retry = () => { if (vaultCleanupError()) { window.location.reload(); return; } if (!initial.error) { setLoadError(''); setAttempt(n => n + 1); } };
  return { owner, engine, loadError: loadError || vaultCleanupError(), record, key, balances, scan, scanPhase, syncError, synchronized: !!key && syncVersion === version && !syncError && scan === null, refresh, sync, unlocked, lock, forget, recoverLegacy, retry };
}
type Vault = ReturnType<typeof useVault>;

function useSender() {
  const { userId } = useSession();
  const { wallet, getProvider } = useEvmWallet();
  return useCallback(async () => {
    if (!wallet || !getProvider || !userId) throw new Error('Connect your EVM wallet first.');
    const guard = vaultContext(userId);
    const provider = await getProvider(wallet.address) as EIP1193Provider; guard();
    return evmSender(provider, wallet.address as `0x${string}`, userId);
  }, [wallet, getProvider, userId]);
}

const errorText = safeMainnetError;
const grouped = (v: string) => { const [i, f] = v.split('.'); return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${f ? `.${f}` : ''}`; };
const money = (units: bigint | undefined) => units === undefined ? '—' : `${grouped(formatUsdc(units))} ${USDC.symbol}`;

function Panel({ title, kicker, children, action }: { title: string; kicker?: string; children: ReactNode; action?: ReactNode }) {
  return <section className="rg-panel"><header className="rg-panel-head"><div>{kicker && <p className="rg-kicker">{kicker}</p>}<h2>{title}</h2></div>{action}</header>{children}</section>;
}

function CopyAddress({ value }: { value: string }) {
  const [done, setDone] = useState(false), [failed, setFailed] = useState(false);
  return <div className="rg-address"><code title={value}>{value}</code>
    <button type="button" className="button button-secondary" onClick={async () => { try { await navigator.clipboard.writeText(value); setDone(true); setFailed(false); setTimeout(() => setDone(false), 1600); } catch { setFailed(true); } }}>{done ? <Check size={15} /> : <Copy size={15} />}{done ? 'Copied' : 'Copy'}</button>{failed && <span role="status">Copy unavailable. Select the address to copy it.</span>}</div>;
}

function Progress({ stage, pct }: { stage: string; pct?: number }) {
  const label: Record<string, string> = { preflight: 'Checking wallet and transaction safety', approve: 'Approve USDC in your wallet', sign: 'Sign the shield key message', estimate: 'Estimating gas', prove: 'Generating zero-knowledge proof', submit: 'Confirm the transaction in your wallet' };
  return <p className="rg-progress" role="status"><RefreshCw size={14} className="spin" />{label[stage] ?? stage}{stage === 'prove' && pct !== undefined ? ` · ${Math.round(pct * 100)}%` : ''}</p>;
}

function Done({ hash, children }: { hash: string; children: ReactNode }) {
  return <Notice tone="success" icon={Check}><p>{children}</p><a className="text-link" href={txUrl(hash)} target="_blank" rel="noreferrer">View on Etherscan · {short(hash)}</a></Notice>;
}

// ---------------------------------------------------------------- vault setup / unlock
function VaultSetup({ vault }: { vault: Vault }) {
  const mounted = useRef(true), pendingWallet = useRef<VaultRecord | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pendingWallet.current && !currentVaultSession(vault.owner)) vault.engine?.unloadVault(pendingWallet.current.walletId);
    };
  }, [vault.engine, vault.owner]);
  const [mode, setMode] = useState<'create' | 'import'>('create');
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [backup, setBackup] = useState<{ record: VaultRecord; key: string; mnemonic: string; file: VaultBackup } | null>(null);
  const [file, setFile] = useState<VaultBackup | null>(null), [filePassword, setFilePassword] = useState('');
  const [answers, setAnswers] = useState(['', '', '']);
  const [saved, setSaved] = useState(false);
  if (backup) return <Panel kicker="Step 2 of 2 · Back up" title="Write down your recovery phrase">
    <p className="rg-copy">These 12 words are the only way to recover your private balance. SQL cannot reset them. Store them offline.</p>
    <ol className="rg-mnemonic">{backup.mnemonic.split(' ').map((w, i) => <li key={i}><span>{String(i + 1).padStart(2, '0')}</span>{w}</li>)}</ol>
    <p className="rg-copy">Confirm the following words from your written backup before opening the vault.</p>
    {[2, 7, 11].map((position, i) => <label className="field" key={position}><span>Recovery word {position + 1}</span><input value={answers[i]} onChange={e => setAnswers(answers.map((answer, j) => j === i ? e.target.value : answer))} autoComplete="off" autoCapitalize="none" spellCheck={false} /></label>)}
    <label className="rg-check"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} /> I saved my recovery phrase somewhere safe.</label>
    <div className="button-row"><Button variant="secondary" onClick={() => downloadVaultBackup(backup.file)}>Download encrypted backup</Button><Button icon={ShieldCheck} disabled={!saved || !answers.every((answer, i) => answer.trim().toLowerCase() === backup.mnemonic.split(' ')[[2, 7, 11][i]])} onClick={() => { try { vault.unlocked(backup.record, backup.key); } catch (e) { setError(errorText(e)); } }}>Open my vault</Button></div>
    {error && <p role="alert" className="form-error">{error}</p>}
    <p className="rg-note">The downloaded file is encrypted with the vault password. Keep a separate offline recovery phrase as well. Never send either password or phrase to support.</p>
  </Panel>;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    if (password.length < 10) return setError('Use a vault password of at least 10 characters.');
    if (password !== confirm) return setError('The passwords do not match.');
    if (!vault.engine) return;
    setBusy(true); const guard = vaultContext(vault.owner);
    try {
      const mnemonic = file ? await decryptVaultBackup(file, filePassword) : phrase.trim();
      guard();
      const block = mode === 'create' ? Number(await (await import('../lib/railgun-runtime')).mainnetClient.getBlockNumber()) : undefined;
      const out = await vault.engine.createVault(password, mode === 'import' ? { mnemonic } : { creationBlock: block });
      pendingWallet.current = out.record;
      try { guard(); if (!mounted.current) throw new Error('Your wallet or vault changed.'); }
      catch (error) { vault.engine.unloadVault(out.record.walletId); throw error; }
      if (file && file.address !== out.record.railgunAddress) throw new Error('The backup address does not match the recovered vault.');
      if (out.mnemonic) {
        const encrypted = await encryptVaultBackup(out.mnemonic, password, out.record.railgunAddress); guard();
        setBackup({ record: out.record, key: out.key, mnemonic: out.mnemonic, file: encrypted });
      } else vault.unlocked(out.record, out.key);
      setPassword(''); setConfirm(''); setPhrase(''); setFilePassword('');
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  return <Panel kicker="Step 1 of 2 · Private vault" title={mode === 'create' ? 'Create your private vault' : 'Import a Railgun wallet'}
    action={<button type="button" disabled={busy} className="text-link" onClick={() => { setMode(mode === 'create' ? 'import' : 'create'); setError(''); setPhrase(''); setPassword(''); setConfirm(''); setFilePassword(''); setFile(null); }}>{mode === 'create' ? 'Import recovery phrase or backup' : 'Create a new vault'}</button>}>
    <p className="rg-copy">Your vault is a Railgun 0zk wallet that lives only in this browser, encrypted with your password. Your EVM wallet funds it and pays gas; it never holds the private balance.</p>
    <form className="rg-form" onSubmit={e => void submit(e)}>
      {mode === 'import' && <>
        <label className="field"><span>Encrypted backup file (optional, processed only in this browser)</span><input type="file" accept=".json,application/json" disabled={busy} onChange={async e => {
          const selected = e.target.files?.[0]; if (!selected) { setFile(null); return; }
          try { if (selected.size > 32_768) throw new Error('The backup file is too large.'); setFile(parseVaultBackup(await selected.text())); setPhrase(''); setError(''); }
          catch (error) { setFile(null); setError(errorText(error)); e.target.value = ''; }
        }} /></label>
        {file ? <label className="field"><span>Backup file password</span><input type="password" disabled={busy} value={filePassword} onChange={e => setFilePassword(e.target.value)} autoComplete="off" required /></label>
          : <label className="field"><span>Recovery phrase</span><textarea rows={3} disabled={busy} value={phrase} onChange={e => setPhrase(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="12 or 24 words" required /></label>}
      </>}
      <label className="field"><span>Vault password</span><input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" minLength={10} required /></label>
      <label className="field"><span>Confirm password</span><input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" minLength={10} required /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="button-row"><Button type="submit" icon={KeyRound} busy={busy} disabled={!vault.engine}>{mode === 'create' ? 'Create vault' : 'Import vault'}</Button></div>
    </form>
    <p className="rg-note">An older browser vault is never assigned to a new wallet automatically.</p><Button variant="ghost" disabled={busy} onClick={vault.recoverLegacy}>Recover an existing browser vault</Button>
  </Panel>;
}

function VaultUnlock({ vault }: { vault: Vault }) {
  const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!vault.engine || !vault.record) return; setBusy(true); setError('');
    const guard = vaultContext(vault.owner);
    try {
      const key = await vault.engine.unlockVault(vault.record, password);
      try { guard(); } catch (error) { vault.engine.unloadVault(vault.record.walletId); throw error; }
      vault.unlocked(vault.record, key);
    }
    catch (err) { setError(errorText(err)); } finally { setPassword(''); setBusy(false); }
  };
  return <Panel kicker="Vault locked" title="Unlock your private vault">
    <CopyAddress value={vault.record!.railgunAddress} />
    <form className="rg-form" onSubmit={e => void submit(e)}>
      <label className="field"><span>Vault password</span><input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required autoFocus /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="button-row"><Button type="submit" icon={Unlock} busy={busy} disabled={!vault.engine}>Unlock</Button>
        <Button type="button" disabled={busy} variant="ghost" icon={Trash2} onClick={() => { if (confirm('Remove this wallet’s saved vault reference? This does not withdraw funds. You must have the recovery phrase or encrypted backup to restore access.')) { try { vault.forget(); } catch (e) { setError(errorText(e)); } } }}>Remove from this browser</Button></div>
    </form>
  </Panel>;
}

function NeedsVault({ vault, children }: { vault: Vault; children: ReactNode }) {
  if (vault.loadError) return <Notice tone="warning"><p><strong>Railgun could not open safely.</strong> {vault.loadError}</p><p>Existing vault data has not been removed.</p><Button variant="secondary" onClick={vault.retry}>Retry connection</Button></Notice>;
  if (!vault.engine) return <p className="rg-progress" role="status"><RefreshCw size={14} className="spin" />Starting the Railgun engine…</p>;
  if (!vault.record) return <VaultSetup vault={vault} />;
  if (!vault.key) return <VaultUnlock vault={vault} />;
  return children;
}

function BalanceStrip({ vault }: { vault: Vault }) {
  const b = vault.balances;
  const { hideBalances } = useStore();
  const balance = (value: bigint | undefined) => hideBalances ? 'Hidden' : money(value);
  return <div className="rg-stats">
    <div><span>Spendable</span><b>{balance(b?.spendable)}</b></div>
    <div><span>Pending checks</span><b>{balance(b?.pending)}</b></div>
    <div><span>Total private</span><b>{balance(b?.total)}</b></div>
    {vault.scan !== null && <p className="rg-scan" role="status">Syncing Railgun history · {vault.scanPhase === 'proofs' ? 'Verifying transaction proofs' : 'Downloading and validating notes'} · {Math.round(vault.scan * 100)}%. The first scan can take several minutes.</p>}
    {vault.syncError && <p className="form-error" role="alert">{vault.syncError} Transfers remain blocked until synchronization completes. <button type="button" className="text-link" onClick={() => void vault.sync()}>Retry synchronization</button></p>}
    {!vault.synchronized && vault.scan === null && !vault.syncError && <p role="status" className="rg-note">Waiting for synchronized balances. Transfers are blocked until the scan completes.</p>}
  </div>;
}

// ---------------------------------------------------------------- vault screen
function ShieldForm({ vault }: { vault: Vault }) {
  const sender = useSender(); const { wallet } = useEvmWallet();
  const [amount, setAmount] = useState(''); const [stage, setStage] = useState<{ s: string; p?: number } | null>(null);
  const [error, setError] = useState(''); const [hash, setHash] = useState(''); const [pub, setPub] = useState<bigint | null>(null);
  const submitting = useRef(false); const [reviewed, setReviewed] = useState(false);
  useEffect(() => { let live = true; setPub(null); if (wallet) publicUsdcBalance(USDC.address, wallet.address as `0x${string}`).then(value => { if (live) setPub(value); }).catch(() => { if (live) setPub(null); }); return () => { live = false; }; }, [wallet?.address, hash]);
  const units = useMemo(() => { try { return parseUsdc(amount); } catch { return null; } }, [amount]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (submitting.current || !units || !vault.engine || !vault.record) return; setError(''); setHash('');
    if (!reviewed || !vault.synchronized || pub === null || units > pub) return setError('Check the deposit amount and wait for vault synchronization to complete.');
    submitting.current = true; setStage({ s: 'preflight' });
    try { assertTransactionsEnabled(config.mainnetTransactionsEnabled); const h = await vault.engine.shieldUsdc(await sender(), vault.record, units, (s, p) => setStage({ s, p })); setHash(h); setAmount(''); setReviewed(false); void vault.sync(); }
    catch (err) { setError(errorText(err)); } finally { submitting.current = false; setStage(null); }
  };
  return <Panel kicker="Deposit · public → private" title="Shield USDC">
    <form className="rg-form" onSubmit={e => void submit(e)}>
      <label className="field"><span>Amount ({USDC.symbol}) · wallet balance {pub === null ? '—' : grouped(formatUsdc(pub))}</span>
        <div className="rg-inline"><input inputMode="decimal" disabled={!!stage} value={amount} onChange={e => { setAmount(e.target.value); setReviewed(false); }} placeholder="0.00" required />
          {pub !== null && pub > 0n && <button type="button" disabled={!!stage} className="button button-secondary" onClick={() => { setAmount(formatUsdc(pub)); setReviewed(false); }}>Max</button>}</div></label>
      {units && <p className="rg-note">Railgun fee {Number(RAILGUN_FEE_BPS) / 100}% · {formatUsdc(railgunFee(units))} {USDC.symbol}. You receive {formatUsdc(afterFee(units))} {USDC.symbol} privately. New deposits pass Railgun's Proof of Innocence check (about an hour) before they are spendable.</p>}
      {stage && <Progress stage={stage.s} pct={stage.p} />}
      {error && <p className="form-error" role="alert">{error}</p>}
      {hash && <Done hash={hash}>Shield submitted. It will show as pending, then spendable.</Done>}
      <label className="rg-check"><input type="checkbox" checked={reviewed} disabled={!!stage} onChange={e => setReviewed(e.target.checked)} /> I checked this real mainnet deposit amount, the fee, and the required ETH gas.</label>
      <div className="button-row"><Button type="submit" icon={ArrowDownToLine} busy={!!stage} disabled={!config.mainnetTransactionsEnabled || !reviewed || !vault.synchronized || !units || pub === null || units > pub}>Shield</Button></div>
    </form>
  </Panel>;
}

function WithdrawForm({ vault }: { vault: Vault }) {
  const sender = useSender(); const { wallet } = useEvmWallet();
  const [to, setTo] = useState(''); const [amount, setAmount] = useState('');
  const [stage, setStage] = useState<{ s: string; p?: number } | null>(null); const [error, setError] = useState(''); const [hash, setHash] = useState('');
  const submitting = useRef(false); const [reviewed, setReviewed] = useState(false);
  const units = useMemo(() => { try { return parseUsdc(amount); } catch { return null; } }, [amount]);
  const validTo = /^0x[0-9a-fA-F]{40}$/.test(to) && !/^0x0{40}$/i.test(to);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (submitting.current || !units || !validTo || !vault.engine || !vault.record || !vault.key) return; setError(''); setHash('');
    if (!reviewed || !vault.synchronized) return setError('Check the withdrawal and wait for vault synchronization to complete.');
    submitting.current = true; setStage({ s: 'preflight' });
    try { assertTransactionsEnabled(config.mainnetTransactionsEnabled); const h = await vault.engine.unshieldUsdc(await sender(), vault.record, vault.key, to as `0x${string}`, units, (s, p) => setStage({ s, p })); setHash(h); setAmount(''); setReviewed(false); void vault.sync(); }
    catch (err) { setError(errorText(err)); } finally { submitting.current = false; setStage(null); }
  };
  return <><Panel kicker="Withdraw · private → public" title="Unshield USDC">
    <form className="rg-form" onSubmit={e => void submit(e)}>
      <label className="field"><span>Destination address</span><div className="rg-inline"><input disabled={!!stage} value={to} onChange={e => { setTo(e.target.value.trim()); setReviewed(false); }} placeholder="0x…" spellCheck={false} required />
        {wallet && <button type="button" disabled={!!stage} className="button button-secondary" onClick={() => { setTo(wallet.address); setReviewed(false); }}>My wallet</button>}</div></label>
      <label className="field"><span>Amount ({USDC.symbol}) · spendable {money(vault.balances?.spendable)}</span><input disabled={!!stage} inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setReviewed(false); }} placeholder="0.00" required /></label>
      <p className="rg-note">For privacy, withdraw to a fresh address, not the wallet that funded the vault. Railgun fee {Number(RAILGUN_FEE_BPS) / 100}%.</p>
      {stage && <Progress stage={stage.s} pct={stage.p} />}
      {error && <p className="form-error" role="alert">{error}</p>}
      {hash && <Done hash={hash}>Withdrawal confirmed.</Done>}
      <label className="rg-check"><input type="checkbox" checked={reviewed} disabled={!!stage} onChange={e => setReviewed(e.target.checked)} /> I checked the full destination address, amount, fee, and ETH gas. A confirmed withdrawal cannot be reversed.</label>
        <div className="button-row"><Button type="submit" icon={ArrowUpFromLine} busy={!!stage} disabled={!config.mainnetTransactionsEnabled || !reviewed || !vault.synchronized || !units || !validTo || (vault.balances ? units > vault.balances.spendable : true)}>Unshield</Button></div>
    </form>
  </Panel><OriginWithdrawal engine={vault.engine} record={vault.record} encryptionKey={vault.key} synchronized={vault.synchronized} getSender={sender} onComplete={() => { void vault.sync(); }} /></>;
}

function VaultHeaderActions({ vault }: { vault: Vault }) {
  const [busy, setBusy] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false), [password, setPassword] = useState(''), [error, setError] = useState('');
  if (!vault.key) return null;
  return <div>
    <div className="button-row">
    <Button variant="secondary" icon={RefreshCw} busy={busy} onClick={async () => { setBusy(true); try { await vault.sync(); } finally { setBusy(false); } }}>Sync</Button>
    <Button variant="secondary" disabled={busy || vault.scan !== null} onClick={async () => { if (!confirm('Rebuild the full Railgun history from deployment? This may take a long time. Keys and recovery material will not be deleted. Keep this browser open.')) return; setBusy(true); try { await vault.sync(true); } finally { setBusy(false); } }}>Full history scan</Button>
    <Button variant="secondary" disabled={busy} onClick={() => setBackupOpen(value => !value)}>Encrypted backup</Button>
    <Button variant="ghost" icon={Lock} onClick={vault.lock}>Lock</Button>
    </div>
    {backupOpen && <form className="rg-form" onSubmit={async e => {
      e.preventDefault(); if (!vault.engine || !vault.record) return; setBusy(true); setError('');
      const guard = vaultContext(vault.owner);
      try {
        const key = await vault.engine.unlockVault(vault.record, password); guard();
        const mnemonic = await vault.engine.revealMnemonic(vault.record, key); guard();
        const file = await encryptVaultBackup(mnemonic, password, vault.record.railgunAddress); guard();
        downloadVaultBackup(file); setBackupOpen(false);
      } catch (error) { setError(errorText(error)); } finally { setPassword(''); setBusy(false); }
    }}><label className="field"><span>Confirm vault password to export an encrypted backup</span><input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></label><Button type="submit" busy={busy}>Download encrypted backup</Button></form>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </div>;
}

export function RailgunVault({ audience }: { audience: 'organization' | 'individual' }) {
  const vault = useVault();
  return <>
    <PageHeader title={audience === 'organization' ? 'Private vault' : 'Private balance'} description="USDC held privately in Railgun on Ethereum mainnet. Only your vault can see the balance." action={<VaultHeaderActions vault={vault} />} />
    <MainnetSafety />
    <NeedsVault vault={vault}>
      <Panel kicker="Your 0zk address" title="Railgun vault"><CopyAddress value={vault.record?.railgunAddress ?? ''} /><BalanceStrip vault={vault} /></Panel>
      <div className="rg-grid"><ShieldForm vault={vault} /><WithdrawForm vault={vault} /></div>
      <VaultHistory engine={vault.engine!} record={vault.record!} owner={vault.owner} synchronized={vault.synchronized} refreshKey={vault.balances} />
    </NeedsVault>
  </>;
}

// ---------------------------------------------------------------- payouts
const emptyRow = (): PayoutRow => ({ name: '', amount: '' });

export function RailgunPayout() {
  const vault = useVault(); const sender = useSender(); const { wallet } = useEvmWallet();
  const [rows, setRows] = useState<PayoutRow[]>([emptyRow()]); const [memo, setMemo] = useState('');
  const [plan, setPlan] = useState<{ resolved: ResolvedRow[]; issues: RecipientIssue[]; total: bigint } | null>(null);
  const [checking, setChecking] = useState(false); const [stage, setStage] = useState<{ s: string; p?: number } | null>(null);
  const [error, setError] = useState(''); const [hash, setHash] = useState('');
  const requestId = useRef(0), submitting = useRef(false); const [reviewed, setReviewed] = useState(false);
  const updateRows = (next: PayoutRow[]) => { requestId.current++; setRows(next); setPlan(null); setHash(''); setChecking(false); setReviewed(false); };
  const edit = (i: number, patch: Partial<PayoutRow>) => updateRows(rows.map((r, j) => j === i ? { ...r, ...patch } : r));
  const check = async (e: FormEvent) => {
    e.preventDefault(); if (!vault.engine || submitting.current) return; setError(''); setChecking(true); setReviewed(false);
    const id = ++requestId.current;
    try {
      if (rows.some(row => !row.name.trim() && row.amount.trim())) throw new Error('Enter a recipient for every amount.');
      const result = await resolveRecipients(rows.filter(r => r.name.trim()), readEnsText, vault.engine.isRailgunAddress);
      if (id === requestId.current) setPlan(result);
    }
    catch (err) { if (id === requestId.current) setError(errorText(err)); } finally { if (id === requestId.current) setChecking(false); }
  };
  const pay = async () => {
    if (submitting.current || !plan || !vault.engine || !vault.record || !vault.key) return; setError('');
    if (!reviewed || !vault.synchronized || plan.issues.length || !plan.resolved.length) return setError('Review every recipient and wait for vault synchronization to complete.');
    submitting.current = true; setStage({ s: 'preflight' });
    try { assertTransactionsEnabled(config.mainnetTransactionsEnabled); const h = await vault.engine.privatePayout(await sender(), vault.record, vault.key, plan.resolved, memo.trim() || undefined, (s, p) => setStage({ s, p })); setHash(h); setRows([emptyRow()]); setPlan(null); setMemo(''); setReviewed(false); void vault.sync(); }
    catch (err) { setError(errorText(err)); } finally { submitting.current = false; setStage(null); }
  };
  const short0zk = (a: string) => `${a.slice(0, 10)}…${a.slice(-6)}`;
  const enough = plan && vault.balances ? plan.total <= vault.balances.spendable : false;
  return <>
    <PageHeader title="Private payout" description={`Pay up to ${MAX_RECIPIENTS} ENS names or 0zk addresses in one Railgun transfer. Recipients and amounts are encrypted on chain.`} action={<VaultHeaderActions vault={vault} />} />
    <MainnetSafety />
    <NeedsVault vault={vault}>
      <BalanceStrip vault={vault} />
      <Panel kicker="Batch" title="Recipients">
        <form className="rg-form" onSubmit={e => void check(e)}>
          <div className="rg-rows">{rows.map((row, i) => <div className="rg-row" key={i}>
            <span className="rg-idx">{String(i + 1).padStart(2, '0')}</span>
            <input disabled={!!stage} aria-label={`Recipient ${i + 1}`} value={row.name} onChange={e => edit(i, { name: e.target.value })} placeholder="alice.eth or 0zk1…" spellCheck={false} />
            <input disabled={!!stage} aria-label={`Amount ${i + 1}`} inputMode="decimal" value={row.amount} onChange={e => edit(i, { amount: e.target.value })} placeholder={`0.00 ${USDC.symbol}`} />
            <button type="button" className="icon-button" aria-label={`Remove recipient ${i + 1}`} disabled={!!stage || rows.length === 1} onClick={() => updateRows(rows.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
          </div>)}</div>
          <div className="button-row"><Button type="button" variant="secondary" icon={Plus} disabled={!!stage || rows.length >= MAX_RECIPIENTS} onClick={() => updateRows([...rows, emptyRow()])}>Add recipient</Button></div>
          <label className="field"><span>Private memo (optional, only recipients can read it)</span><input disabled={!!stage} value={memo} onChange={e => { setMemo(e.target.value); setReviewed(false); }} maxLength={120} placeholder="October payroll" /></label>
          <p className="rg-note">ENS names must have a <code>{ENS_RAILGUN_RECORD}</code> text record on Ethereum mainnet holding the recipient's 0zk address.</p>
          <div className="button-row"><Button type="submit" disabled={!!stage} variant="secondary" icon={ShieldCheck} busy={checking}>Check recipients</Button></div>
        </form>
      </Panel>
      {plan && <Panel kicker="Review" title={`${plan.resolved.length} ready · ${money(plan.total)}`}>
        <ul className="rg-review">{plan.resolved.map(r => <li key={r.railgunAddress}><b>{r.name.startsWith('0zk') ? short0zk(r.name) : r.name}</b><code>{short0zk(r.railgunAddress)}</code><span>{money(r.amount)}</span></li>)}
          {plan.issues.map(i => <li key={i.name} className="is-issue"><b>{i.name}</b><span>{i.detail}</span></li>)}</ul>
        {!enough && plan.resolved.length > 0 && <p className="form-error">Spendable balance is lower than the batch total. Shield more USDC or wait for pending checks.</p>}
        <p className="rg-note">You sign one transaction from {wallet ? short(wallet.address) : 'your connected wallet'}. It pays gas; on chain it shows a Railgun interaction, not the recipients or amounts.</p>
        {stage && <Progress stage={stage.s} pct={stage.p} />}
        {error && <p className="form-error" role="alert">{error}</p>}
        <label className="rg-check"><input type="checkbox" checked={reviewed} disabled={!!stage} onChange={e => setReviewed(e.target.checked)} /> I reviewed all resolved addresses, amounts, the memo, and ETH gas on Ethereum mainnet.</label>
        <div className="button-row"><Button icon={Send} busy={!!stage} disabled={!config.mainnetTransactionsEnabled || !reviewed || !vault.synchronized || !enough || plan.resolved.length === 0 || plan.issues.length > 0} onClick={() => void pay()}>Send private payout</Button></div>
      </Panel>}
      {!plan && error && <p className="form-error" role="alert">{error}</p>}
      {hash && <Done hash={hash}>Private payout confirmed. Recipients see it in their Railgun balance after their wallet syncs.</Done>}
    </NeedsVault>
  </>;
}

// ---------------------------------------------------------------- receiving
export function RailgunReceive() {
  const vault = useVault();
  return <>
    <PageHeader title="Receive privately" description="Share your ENS name. Payers resolve it to your Railgun 0zk address; payments land in your private balance." action={<VaultHeaderActions vault={vault} />} />
    <MainnetSafety />
    <NeedsVault vault={vault}>
      <Panel kicker="Your 0zk address" title="Payment address"><CopyAddress value={vault.record?.railgunAddress ?? ''} /><BalanceStrip vault={vault} /></Panel>
      <Panel kicker="One-time setup" title="Link it to your ENS name">
        <ol className="rg-steps">
          <li>Open your name in the ENS app on Ethereum mainnet and choose <b>Records → Edit</b>.</li>
          <li>Add a text record with key <code>{ENS_RAILGUN_RECORD}</code> and your 0zk address above as the value.</li>
          <li>Save the record. Payers using SQL can now pay <b>yourname.eth</b> privately.</li>
        </ol>
        <div className="button-row"><a className="button button-secondary" href="https://app.ens.domains/" target="_blank" rel="noreferrer">Open ENS app</a>
          <a className="button button-secondary" href="#/balance">Withdraw funds</a></div>
      </Panel>
    </NeedsVault>
  </>;
}

// ---------------------------------------------------------------- help and status (mainnet)
export function MainnetHelp({ audience }: { audience: 'organization' | 'individual' }) {
  const org = audience === 'organization';
  const faq: [string, string][] = [
    ['What runs on mainnet?', 'Funds live in Railgun, an audited privacy system on Ethereum mainnet. SQL is the console on top: it manages your 0zk vault, resolves ENS names and builds the transactions your wallet signs.'],
    ['What do I need?', 'An EVM wallet on Ethereum mainnet (MetaMask, Rabby, Coinbase Wallet or WalletConnect) with USDC to shield and ETH for gas. SQL never holds your keys or funds.'],
    ['What stays private?', 'Recipients, amounts and private balances are encrypted on chain. Public: your shield deposit (wallet, amount), withdrawals (address, amount) and the fact your wallet sent a Railgun transaction.'],
    ['What if I lose my vault password?', 'Use your 12-word recovery phrase: Import recovery phrase restores the same 0zk address. Without the phrase, nobody (including SQL) can recover the funds.'],
    ['Why is a new deposit "pending"?', 'Railgun runs a Private Proof of Innocence check on shielded funds before they can be spent. It usually takes about an hour.'],
    ['Is it safe for large amounts?', 'Railgun is audited and has run on mainnet since 2022. The SQL console is new and has not had its own independent audit, so start with small amounts.'],
  ];
  return <>
    <PageHeader title="Help" description="Private payouts on Ethereum mainnet, powered by Railgun." />
    <Panel kicker="Quick start" title={org ? 'Send a private payout' : 'Receive privately'}>
      <ol className="rg-steps">{(org
        ? ['Connect your EVM wallet on Ethereum mainnet.', 'Open Private vault, create your vault and save the recovery phrase.', 'Shield USDC into the vault. Wait for the pending check to clear.', 'Open Payouts, add ENS names or 0zk addresses, check them and send.']
        : ['Connect your EVM wallet on Ethereum mainnet.', 'Open Receive and create your vault; save the recovery phrase.', `Add your 0zk address as the "${ENS_RAILGUN_RECORD}" text record on your ENS name.`, 'Payments arrive in Balance. Withdraw to a fresh address when you need them public.']
      ).map(s => <li key={s}>{s}</li>)}</ol>
    </Panel>
    {faq.map(([q, a]) => <details className="progressive-details" key={q}><summary>{q}</summary><p>{a}</p></details>)}
  </>;
}

export function MainnetStatus() {
  const [block, setBlock] = useState<bigint | null>(null); const [rpcError, setRpcError] = useState('');
  useEffect(() => { import('../lib/railgun-runtime').then(m => m.mainnetClient.getBlockNumber()).then(setBlock).catch(e => setRpcError(errorText(e))); }, []);
  const rows: [string, ReactNode][] = [
    ['Network', 'Ethereum mainnet · chain 1'],
    ['Privacy system', 'Railgun V2 (Poseidon merkle) · audited'],
    ['Railgun proxy', <a className="text-link" href={`https://etherscan.io/address/0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9`} target="_blank" rel="noreferrer">0xfa70…a4b9</a>],
    ['Asset', <a className="text-link" href={`https://etherscan.io/token/${USDC.address}`} target="_blank" rel="noreferrer">USDC · {short(USDC.address)}</a>],
    ['RPC', rpcError ? <span className="form-error">{rpcError}</span> : block === null ? 'Checking…' : `Connected · block ${block.toString()}`],
    ['Fees', `Railgun ${Number(RAILGUN_FEE_BPS) / 100}% on shield and unshield, plus gas`],
  ];
  return <>
    <PageHeader title="Connection status" description="What this console talks to on Ethereum mainnet." />
    <Panel kicker="Mainnet" title="SQL × Railgun"><ul className="rg-review">{rows.map(([k, v]) => <li key={k} className="is-issue"><b>{k}</b><span className="rg-status-v">{v}</span></li>)}</ul></Panel>
  </>;
}
