import { getAddress, type Address, type Hex } from 'viem';
import { normalizePaymentName } from '@null-protocol/ens';

export type PendingNameUpdate = { version: 1; hash: Hex; data: Hex; name: string; resolver: Address; account: Address; kind: 'profile' | 'grant' | 'revoke'; editor?: Address; fingerprint: Hex };
const key = (userId: string) => `null:ens:pending:v1:${encodeURIComponent(userId)}`;
export function parsePendingNameUpdate(raw: string | null): PendingNameUpdate | undefined {
  if (!raw || raw.length > 4096) return;
  try {
    const value = JSON.parse(raw);
    if (value.version !== 1 || !/^0x[0-9a-fA-F]{64}$/.test(value.hash) || typeof value.data !== 'string' || !/^0x(?:[0-9a-fA-F]{2}){4,1500}$/.test(value.data) || !/^0x[0-9a-fA-F]{64}$/.test(value.fingerprint) || !['profile', 'grant', 'revoke'].includes(value.kind)) return;
    const name = normalizePaymentName(value.name);
    const editor = value.kind === 'profile' ? undefined : getAddress(value.editor);
    return { version: 1, hash: value.hash, data: value.data, name, resolver: getAddress(value.resolver), account: getAddress(value.account), kind: value.kind, editor, fingerprint: value.fingerprint };
  } catch { return; }
}
export function readPendingNameUpdate(userId: string): PendingNameUpdate | undefined {
  try { return parsePendingNameUpdate(sessionStorage.getItem(key(userId))); } catch { return; }
}
export function savePendingNameUpdate(userId: string, value: PendingNameUpdate) {
  sessionStorage.setItem(key(userId), JSON.stringify(value));
}
export function clearPendingNameUpdate(userId: string) { sessionStorage.removeItem(key(userId)); }
