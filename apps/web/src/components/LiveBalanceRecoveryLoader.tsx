import { lazy, Suspense } from 'react';
import type { ProfileKeys } from '@null-protocol/sdk';
import type { PrivateNote } from '../lib/store';
import { Modal } from './ui';

const LiveBalanceRecovery = lazy(() => import('./LiveBalanceRecovery').then(module => ({ default: module.LiveBalanceRecovery })));
export function LiveBalanceRecoveryLoader({ open, onClose, identityKeys, onRecovered }: { open: boolean; onClose: () => void; identityKeys: ProfileKeys; onRecovered: (value: { treasuryBalance: bigint | null; notes: PrivateNote[] }) => void }) {
  if (!open) return null;
  return <Suspense fallback={<Modal open title="Restore balance" onClose={onClose}><p className="modal-copy" role="status">Opening your backup options…</p></Modal>}><LiveBalanceRecovery open onClose={onClose} identityKeys={identityKeys} onRecovered={onRecovered} /></Suspense>;
}
