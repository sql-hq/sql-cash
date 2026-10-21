import test from 'node:test';
import assert from 'node:assert/strict';
import { compileDistribution, profileFromKeys, bigintToBytes } from '@null-protocol/sdk';
import { verifyCreResult } from './cre';
const context = { chainId: 11155111n, poolAddress: '0x0000000000000000000000000000000000000001' as const };
test('CRE import binds every envelope and context field to the current draft', async () => {
  const publicBundle = (await compileDistribution({ context, batchEntropy: new Uint8Array(32).fill(7), recipients: [{ employeeRef: 'Synthetic test', amountAtomic: 1n, stealthMetaAddress: profileFromKeys({ spendPrivateKey: bigintToBytes(1n), viewPrivateKey: bigintToBytes(2n) }).stealthMetaAddress }] })).publicBundle;
  const result = { version: 1, mode: 'cre-local-simulation', batchId: 'test-batch', publicBundle };
  const read = (value: unknown) => verifyCreResult(JSON.stringify(value), 'test-batch', publicBundle);
  assert.deepEqual(read(result), publicBundle);
  for (const key of ['chainId', 'poolAddress', 'commitment', 'transportTag', 'envelopeRoot']) {
    const changed = structuredClone(result); (changed.publicBundle as unknown as Record<string, unknown>)[key] = key === 'chainId' ? '1' : key === 'poolAddress' ? '0x' + '02'.repeat(20) : '0x' + '02'.repeat(32);
    assert.throws(() => read(changed));
  }
  const ciphertext = structuredClone(result); ciphertext.publicBundle.envelopes[0]!.ciphertext = `0x${'00'.repeat(540)}`; assert.throws(() => read(ciphertext));
  assert.throws(() => read({ ...result, batchId: 'old-batch' }));
  assert.throws(() => read({ ...result, mode: 'remote-attested' }));
  assert.throws(() => read({ ...result, extra: true }));
  assert.throws(() => read({ ...result, publicBundle: { ...publicBundle, secret: 'forbidden' } }));
});
