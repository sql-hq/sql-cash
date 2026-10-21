import { decodeEventLog, parseAbi, type Address, type Hex } from 'viem';
import { namehash } from 'viem/ens';
import { PAYMENT_RECORD, profileFingerprint } from '@null-protocol/ens';
import type { PendingNameUpdate } from './ens-pending';

const textEvents = parseAbi(['event TextChanged(bytes32 indexed node, string indexed indexedKey, string key, string value)']);
type MinedTransaction = { from: Address; to: Address | null; input: Hex };
type Receipt = { status: 'success' | 'reverted'; logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[] };

export function matchesNameUpdate(update: PendingNameUpdate, transaction: MinedTransaction, receipt: Receipt): boolean {
  if (receipt.status !== 'success' || transaction.from.toLowerCase() !== update.account.toLowerCase()) return false;
  if (transaction.to?.toLowerCase() === update.resolver.toLowerCase() && transaction.input.toLowerCase() === update.data.toLowerCase()) return true;
  // Wallets may wrap calls in a batch. Bind confirmation to the actual resolver's
  // event, exact name, SQL record and intended Payment ID, not the outer router.
  if (update.kind !== 'profile') return false;
  return receipt.logs.some(log => {
    if (log.address.toLowerCase() !== update.resolver.toLowerCase()) return false;
    try {
      const event = decodeEventLog({ abi: textEvents, data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true });
      return event.args.node.toLowerCase() === namehash(update.name).toLowerCase() && event.args.key === PAYMENT_RECORD && profileFingerprint(event.args.value).toLowerCase() === update.fingerprint.toLowerCase();
    } catch { return false; }
  });
}
