import { createContext, useContext, useState, type ReactNode } from 'react';
import { parseProfile, profileStorageKey, type WorkspaceProfile } from './account-profile';
export type { AccountType, WorkspaceProfile } from './account-profile';

type Account = { profile: WorkspaceProfile | null; choosingType: boolean; storageWarning: string; updateProfile: (profile: WorkspaceProfile) => void; changeAccountType: () => void; cancelChange: () => void };
const AccountContext = createContext<Account | null>(null);
export function AccountProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [profile, setProfile] = useState(() => {
    try { return parseProfile(localStorage.getItem(profileStorageKey(userId))); } catch { return null; }
  });
  const [choosingType, setChoosingType] = useState(false);
  const [storageWarning, setStorageWarning] = useState('');
  function updateProfile(next: WorkspaceProfile) {
    const valid = parseProfile(JSON.stringify(next));
    if (!valid) throw new Error('Choose an account type and enter an organization name if needed.');
    try { localStorage.setItem(profileStorageKey(userId), JSON.stringify(valid)); setStorageWarning(''); }
    catch { setStorageWarning('Your choice is saved for this session. This browser could not remember it for next time.'); }
    setProfile(valid); setChoosingType(false);
  }
  return <AccountContext.Provider value={{ profile, choosingType, storageWarning, updateProfile, changeAccountType: () => setChoosingType(true), cancelChange: () => setChoosingType(false) }}>{children}</AccountContext.Provider>;
}
export function useAccount() { const value = useContext(AccountContext); if (!value) throw new Error('Account provider missing.'); return value; }
