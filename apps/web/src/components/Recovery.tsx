import { useRef, useState } from 'react';
import { Download, FileUp, KeyRound } from 'lucide-react';
import { NullError, profileFromKeys } from '@null-protocol/sdk';
import { decryptRecovery, encryptRecovery, loadVault, saveVault } from '@null-protocol/wallet';
import { useStore } from '../lib/store';
import { download } from '../lib/format';
import { Button, Modal, Notice } from './ui';

export function Recovery({ open, onClose, initialMode = 'export', continueSetup = false }: { open: boolean; onClose: () => void; initialMode?: 'export' | 'restore'; continueSetup?: boolean }) {
  const store = useStore(); const [mode, setMode] = useState(initialMode); const [password, setPassword] = useState(''); const [repeat, setRepeat] = useState(''); const [file, setFile] = useState<File>(); const [persist, setPersist] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const fileInput = useRef<HTMLInputElement>(null);
  const close = () => { setPassword(''); setRepeat(''); setFile(undefined); setError(''); onClose(); };
  async function submit() {
    setError(''); setBusy(true);
    try {
      if (mode === 'export') {
        if (password !== repeat) throw new Error('The passwords do not match.');
        if (password.length < 12) throw new Error('Choose a password with at least 12 characters.');
        const encrypted = await encryptRecovery(store.identity.keys, password);
        download('sql-encrypted-recovery.json', encrypted);
        await store.markIdentityBackedUp();
        if (persist) { try { await saveVault(encrypted); } catch { store.toast('Backup downloaded, but could not also be saved in this browser. Keep the downloaded file.'); close(); return; } }
        store.toast('Backup downloaded. Keep your password in a separate safe place.');
      } else {
        if (file && file.size > 16384) throw new Error('Choose an SQL Payment ID backup file under 16 KB.');
        const encrypted = file ? await file.text() : await loadVault();
        if (!encrypted) throw new Error('No backup is saved in this browser. Choose your downloaded backup file.');
        const keys = await decryptRecovery(encrypted, password);
        await store.setIdentity({ keys, profile: profileFromKeys(keys) });
        store.toast('Payment ID restored. Check your inbox for payments.');
      }
      close();
    } catch (reason) {
      if (reason instanceof NullError) {
        setError(reason.code === 'NULL_PASSWORD_INVALID' ? 'Use a password with 12 to 1,024 characters.'
          : reason.code === 'NULL_STORAGE_UNAVAILABLE' ? 'Could not open the backup saved in this browser. Choose your downloaded backup file.'
          : 'Could not open this backup. Check that you chose your Payment ID backup and entered its password.');
      } else setError(reason instanceof Error ? reason.message : 'Could not save or restore your backup. Please try again.');
    }
    finally { setBusy(false); }
  }
  return <Modal title={continueSetup ? mode === 'export' ? 'Save your inbox backup' : 'Restore your inbox' : 'Payment ID backup'} description="Keep access to your payments if you change devices or clear your browser." open={open} onClose={() => { if (!busy) close(); }}>
    {!continueSetup && <div className="tabs recovery-tabs">
      <button className={mode === 'export' ? 'selected' : ''} onClick={() => { setMode('export'); setError(''); }}>Save backup</button>
      <button className={mode === 'restore' ? 'selected' : ''} onClick={() => { setMode('restore'); setError(''); }}>Restore backup</button>
    </div>}
    <Notice icon={KeyRound}>Your file and password unlock your payments. Keep them private and store them separately.</Notice>
    {mode === 'restore' && <>
      <button className="file-restore" onClick={() => fileInput.current?.click()}><FileUp size={20} /><span>{file?.name || 'Choose backup file'}</span></button>
      <input type="file" accept=".json,application/json" ref={fileInput} hidden onChange={event => setFile(event.target.files?.[0])} />
      <p className="field-hint">Choose your SQL Payment ID backup (.json, under 16 KB). Leave this empty to use the backup saved in this browser.</p>
    </>}
    <label className="field">Backup password
      <input type="password" autoComplete={mode === 'export' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === 'export' ? 'At least 12 characters' : 'Enter your backup password'} />
      {mode === 'export' && <small>Use 12 to 1,024 characters. You will need this password to restore your backup.</small>}
    </label>
    {mode === 'export' && <>
      <label className="field">Repeat password<input type="password" autoComplete="new-password" value={repeat} onChange={event => setRepeat(event.target.value)} /></label>
      <label className="checkbox-field"><input type="checkbox" checked={persist} onChange={event => setPersist(event.target.checked)} /><span>Also save a password-protected copy in this browser.</span></label>
    </>}
    <details className="progressive-details"><summary>What does this backup save?</summary><p>This saves access to your Payment ID. Your inbox stays available when you refresh this tab. After signing out, closing the browser session, or changing devices, restore your backup. Practice payments and drafts reset when you reload. Your funds backup is separate, under Restore balance.</p></details>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><Button variant="secondary" disabled={busy} onClick={close}>Cancel</Button><Button busy={busy} icon={mode === 'export' ? Download : KeyRound} onClick={() => void submit()}>{mode === 'export' ? continueSetup ? 'Download and continue' : 'Download backup' : 'Restore backup'}</Button></div>
  </Modal>;
}
