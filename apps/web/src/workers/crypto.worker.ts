import { compileDistribution, scanEnvelopes } from '@null-protocol/sdk';

self.onmessage = async ({ data }) => {
  try {
    const result = data.method === 'compile' ? await compileDistribution(data.payload) : data.method === 'scan' ? await scanEnvelopes(data.payload) : undefined;
    if (result === undefined) throw new Error('Unsupported local operation.');
    self.postMessage({ id: data.id, ok: true, result });
  } catch {
    // No plaintext witnesses, profiles, or amount-bearing errors leave this worker.
    self.postMessage({ id: data.id, ok: false });
  }
};
