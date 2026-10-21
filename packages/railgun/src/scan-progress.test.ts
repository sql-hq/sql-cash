import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanProgress } from './scan-progress';

test('notes completion with SDK zero sentinel is halfway, never overall Complete', () => {
  assert.deepEqual(scanProgress('notes', 'Complete', 0, false), { progress: 0.5, status: 'Updated' });
});
test('proof completion normalizes zero sentinel to overall 100%', () => {
  assert.deepEqual(scanProgress('proofs', 'Complete', 0, false), { progress: 1, status: 'Complete' });
});
test('concurrent unfinished notes prevent proof completion from declaring the whole scan complete', () => {
  assert.deepEqual(scanProgress('proofs', 'Complete', 0, true), { progress: 0.99, status: 'Updated' });
});
test('incomplete status remains explicit, including during proofs', () => {
  assert.equal(scanProgress('notes', 'Incomplete', 0.9, false).status, 'Incomplete');
  assert.equal(scanProgress('proofs', 'Incomplete', 0.9, false).status, 'Incomplete');
});
test('untrusted nonfinite or out-of-range SDK progress cannot mark a scan complete', () => {
  for (const value of [NaN, Infinity, -Infinity, -2, 4]) {
    const result = scanProgress('proofs', 'Updated', value, true);
    assert.equal(result.status, 'Updated'); assert(result.progress >= 0 && result.progress < 1);
  }
});
