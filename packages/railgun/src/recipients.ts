import { parseUsdc } from './amounts';
import { ENS_RAILGUN_RECORD } from './network';

export type PayoutRow = { name: string; amount: string; reference?: string };
export type ResolvedRow = { name: string; reference: string; railgunAddress: string; amount: bigint };
export type RecipientIssue = { name: string; reason: 'invalid-name' | 'no-record' | 'invalid-address' | 'invalid-amount' | 'duplicate'; detail: string };

/** Reads one ENS text record on mainnet. Inject viem's getEnsText (or a mock in tests). */
export type EnsTextReader = (name: string, key: string) => Promise<string | null>;

const ENS_NAME = /^(?=.{3,255}$)([a-z0-9-]+\.)+[a-z0-9-]+$/;
/** Shape check for a Railgun 0zk bech32m address. Pass the SDK's validator for a full checksum check. */
export const looksLikeRailgunAddress = (value: string) => /^0zk1[02-9ac-hj-np-z]{100,}$/.test(value);

export const MAX_RECIPIENTS = 10;

/**
 * Resolves payout rows to Railgun addresses. A name is accepted when it is a 0zk address itself
 * or an ENS name whose `railgun` text record holds a valid 0zk address.
 */
export async function resolveRecipients(rows: PayoutRow[], readText: EnsTextReader, validate: (a: string) => boolean = looksLikeRailgunAddress) {
  if (rows.length === 0) throw new RangeError('Add at least one recipient.');
  if (rows.length > MAX_RECIPIENTS) throw new RangeError(`A private payout supports up to ${MAX_RECIPIENTS} recipients per transaction.`);
  const resolved: ResolvedRow[] = []; const issues: RecipientIssue[] = []; const seen = new Set<string>();
  await Promise.all(rows.map(async (row, i) => {
    const name = row.name.trim().toLowerCase(); const reference = row.reference ?? `r${i + 1}`;
    let amount: bigint;
    try { amount = parseUsdc(row.amount); } catch (e) { issues.push({ name, reason: 'invalid-amount', detail: (e as Error).message }); return; }
    let address: string | null = null;
    if (name.startsWith('0zk')) address = row.name.trim();
    else if (!ENS_NAME.test(name)) { issues.push({ name, reason: 'invalid-name', detail: 'Enter an ENS name like alice.eth or a 0zk address.' }); return; }
    else {
      address = (await readText(name, ENS_RAILGUN_RECORD))?.trim() ?? null;
      if (!address) { issues.push({ name, reason: 'no-record', detail: `${name} has no "${ENS_RAILGUN_RECORD}" text record on Ethereum mainnet. Ask the recipient to add their 0zk address.` }); return; }
    }
    if (!validate(address)) { issues.push({ name, reason: 'invalid-address', detail: `${name} does not point to a valid Railgun 0zk address.` }); return; }
    if (seen.has(address)) { issues.push({ name, reason: 'duplicate', detail: `${name} resolves to an address already in this payout.` }); return; }
    seen.add(address);
    resolved.push({ name, reference, railgunAddress: address, amount });
  }));
  const order = new Map(rows.map((r, i) => [r.name.trim().toLowerCase(), i]));
  resolved.sort((a, b) => order.get(a.name)! - order.get(b.name)!);
  return { resolved, issues, total: resolved.reduce((sum, r) => sum + r.amount, 0n) };
}
