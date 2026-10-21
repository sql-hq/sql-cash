import { parsePublicBundle, type PublicDistributionBundle } from '@null-protocol/sdk';
import { canonical } from './internal';

export interface CrePayrollExport {
  batchId: string;
  batchEntropyHex: string;
  recipients: { employeeRef: string; amountAtomic: string; stealthMetaAddress: string }[];
}
/** Checks data integrity against this draft. A local result file is not remote attestation. */
export function verifyCreResult(text: string, batchId: string, expected: PublicDistributionBundle): PublicDistributionBundle {
  if (text.length > 100_000) throw new Error('The CRE result file is too large.');
  let data: Record<string, unknown>;
  try { data = JSON.parse(text); } catch { throw new Error('Choose the JSON result exported by the CRE simulation.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).sort().join(',') !== 'batchId,mode,publicBundle,version' || data.version !== 1 || data.mode !== 'cre-local-simulation' || data.batchId !== batchId) throw new Error('This CRE result belongs to another payment or uses an unsupported format.');
  const bundle = parsePublicBundle(JSON.stringify(data.publicBundle));
  if (canonical(data.publicBundle) !== canonical(bundle) || canonical(bundle) !== canonical(expected)) throw new Error('The CRE result does not match this payment. Nothing was sent. Run the current draft again.');
  return bundle;
}
