import type { compileDistribution, scanEnvelopes } from '@null-protocol/sdk';

type Requests = { compile: Parameters<typeof compileDistribution>[0]; scan: Parameters<typeof scanEnvelopes>[0] };
type Results = { compile: Awaited<ReturnType<typeof compileDistribution>>; scan: Awaited<ReturnType<typeof scanEnvelopes>> };
let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

export function cryptoTask<K extends keyof Requests>(method: K, payload: Requests[K]): Promise<Results[K]> {
  if (!worker) {
    worker = new Worker(new URL('../workers/crypto.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const task = pending.get(data.id); if (!task) return;
      clearTimeout(task.timer); pending.delete(data.id);
      if (data.ok) task.resolve(data.result); else task.reject(new Error('Local cryptographic preparation failed. Check the profiles, amounts, and deployment context.'));
    };
    worker.onerror = () => {
      for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('The private processing worker stopped. Reload the workspace and try again.')); }
      pending.clear(); worker?.terminate(); worker = undefined;
    };
  }
  const id = sequence++;
  return new Promise<Results[K]>((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Local preparation took too long. Try again with this tab in the foreground.')); }, 120000);
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    worker!.postMessage({ id, method, payload });
  });
}
