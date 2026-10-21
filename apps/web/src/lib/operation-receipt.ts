import { keccak256 } from 'viem';
import { matchesSubmittedCall, type ConfirmedOperation, type PreparedOperation } from '@null-protocol/client';

export type ApprovalSource = 'privy-owner' | 'imported' | 'not-required';

/** Explicit allowlist: never serialize a ConfirmedOperation's private note or recovery. */
export function publicOperationReceipt(prepared: PreparedOperation, confirmed: ConfirmedOperation,
  context: { approval: ApprovalSource; compilation?: 'local' | 'cre-local-simulation'; protocolVersion: string }) {
  const operation = prepared.publicOperation;
  const receipt = confirmed.receipt;
  const targetMatches = confirmed.transaction
    ? confirmed.transaction.hash.toLowerCase() === receipt.transactionHash.toLowerCase() && confirmed.transaction.to?.toLowerCase() === receipt.to?.toLowerCase() && matchesSubmittedCall(confirmed.transaction, operation.pool, prepared.transaction.data)
    : receipt.to?.toLowerCase() === operation.pool.toLowerCase();
  if (receipt.status !== 'success' || receipt.transactionHash.toLowerCase() !== confirmed.transactionHash.toLowerCase() ||
      !targetMatches || prepared.transaction.to.toLowerCase() !== operation.pool.toLowerCase() ||
      prepared.transaction.chainId !== operation.chainId || BigInt(operation.publicInputs[1]!) !== BigInt(operation.chainId) ||
      BigInt(operation.publicInputs[2]!) !== BigInt(operation.pool)) throw new Error('The confirmed receipt does not match this operation.');
  if (operation.method === 'createDistribution' && confirmed.distributionCommitment !== operation.publicInputs[7]) {
    throw new Error('The confirmed distribution does not match this payout.');
  }
  if (operation.method === 'createDistribution' && context.approval === 'not-required') throw new Error('Distribution approval evidence is missing.');
  return {
    schema: 'null.public-operation-receipt.v1', chainId: operation.chainId, protocolVersion: context.protocolVersion,
    pool: operation.pool, method: operation.method, transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash, gasUsed: receipt.gasUsed.toString(),
    status: 'confirmed', calldataHash: keccak256(prepared.transaction.data),
    ...(operation.method === 'createDistribution' ? { distributionCommitment: confirmed.distributionCommitment } : {}),
    workflow: { recordedBy: 'local-client', approval: context.approval,
      ...(operation.method === 'createDistribution' ? { compilation: context.compilation ?? 'local' } : {}),
      remoteAttestationVerified: false },
  } as const;
}
export type PublicOperationReceipt = ReturnType<typeof publicOperationReceipt>;
