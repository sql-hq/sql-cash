import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withinScanDeadline } from './scan-deadline';

test('a completed scan returns its original result', async () => {
  assert.equal(await withinScanDeadline(Promise.resolve('verified'), 100), 'verified');
});
test('a stalled scan fails closed without cancelling or falsely completing the original task', async () => {
  let finished = false, complete!: () => void;
  const underlying = new Promise<void>(resolve => { complete = () => { finished = true; resolve(); }; });
  await assert.rejects(withinScanDeadline(underlying, 5), /Transfers remain blocked/);
  assert.equal(finished, false);
  complete(); await underlying; assert.equal(finished, true);
});
test('SDK errors are propagated rather than replaced by success or a timeout', async () => {
  await assert.rejects(withinScanDeadline(Promise.reject(new Error('SDK scan failed')), 100), /SDK scan failed/);
});
