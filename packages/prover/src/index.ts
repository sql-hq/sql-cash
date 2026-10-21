export type { ArtifactReference, CircuitKind, ProofRequest, ProofResult, ProofStage } from './types';
import type { ProofRequest, ProofResult, ProofStage, WorkerResponse } from './types';

/** One fresh isolated worker per proof. Abort destroys the worker and its WASM heap. */
export function proveInWorker(request: ProofRequest, options: {
  signal?: AbortSignal;
  onProgress?: (stage: ProofStage) => void;
} = {}): Promise<ProofResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const id = crypto.randomUUID();
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'null-local-prover' });
    const cleanup = () => { worker.terminate(); options.signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => { cleanup(); reject(new Error('NULL_PROOF_FAILED')); };
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== id) return;
      if ('stage' in event.data) options.onProgress?.(event.data.stage);
      else if ('result' in event.data) { cleanup(); resolve(event.data.result); }
      else { cleanup(); reject(new Error(event.data.error)); }
    };
    worker.postMessage({ id, request });
  });
}
