import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPublicHash } from './public-routes';
test('all former demo links open the real wallet app, including nested and saved links', () => {
  for (const hash of ['#/console', '#/console/inbox', '#/console?wallet=demo', '#/demo', '#/demo/balance']) {
    assert.equal(canonicalPublicHash(hash), '#/app');
  }
});
test('actual app, wallet pages and developer documentation keep their routes', () => {
  for (const hash of ['', '#/', '#/app', '#/inbox', '#/balance', '#/treasury', '#/developers/quickstart']) assert.equal(canonicalPublicHash(hash), hash);
});
