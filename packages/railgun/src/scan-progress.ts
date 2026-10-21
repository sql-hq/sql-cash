export type ScanPhase = 'notes' | 'proofs';

// The SDK reports progress=0 for Complete. Neither 100% notes nor a proof
// completion while notes are still pending can unlock transfers by itself.
export function scanProgress(phase: ScanPhase, status: string, value: number, pending: boolean) {
  const progress = status === 'Complete' ? 1 : Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const overall = phase === 'notes' ? progress * 0.5 : 0.5 + progress * 0.5;
  const combinedStatus = status === 'Incomplete' ? 'Incomplete' : phase === 'proofs' && status === 'Complete' && !pending ? 'Complete' : 'Updated';
  return { progress: combinedStatus === 'Complete' ? 1 : Math.min(0.99, overall), status: combinedStatus };
}
