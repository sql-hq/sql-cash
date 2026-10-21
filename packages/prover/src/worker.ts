import { proveLocally } from './runtime';
import type { WorkerRequest, WorkerResponse } from './types';

let busy = false;
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, request } = event.data;
  const send = (message: WorkerResponse) => self.postMessage(message);
  if (busy) { send({ id, error: 'NULL_PROVER_BUSY' }); return; }
  busy = true;
  try {
    const result = await proveLocally(request, stage => send({ id, stage }));
    send({ id, result });
  } catch (error) {
    // Never forward compiler/solver errors containing private witness values.
    const allowed = ['NULL_ARTIFACT_UNAVAILABLE', 'NULL_ARTIFACT_MISMATCH', 'NULL_CONTEXT_MISMATCH'];
    send({ id, error: error instanceof Error && allowed.includes(error.message) ? error.message : 'NULL_PROOF_FAILED' });
  } finally { busy = false; }
};

