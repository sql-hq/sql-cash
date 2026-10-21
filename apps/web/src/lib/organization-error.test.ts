import test from 'node:test';
import assert from 'node:assert/strict';
import { organizationResponseError } from './organization-error';

test('membership rejection explains switching to the organization owner account', async () => {
  const error = await organizationResponseError(Response.json({ code: 'NULL_ORGANIZATION_FORBIDDEN' }, { status: 403 }));
  assert.equal(error.title, 'Organization access required');
  assert.match(error.message, /Sign out and sign in/);
  assert.doesNotMatch(error.message, /ENS/);
});

test('session, throttling, origin and service failures have distinct recovery instructions', async () => {
  for (const [status, code, expected] of [
    [401, 'NULL_SESSION_INVALID', 'Sign in again'],
    [429, 'NULL_RATE_LIMITED', 'Please wait before checking again'],
    [403, 'NULL_ORIGIN_REJECTED', 'Organization access unavailable here'],
    [409, 'NULL_PRIVY_CONTROL_MISMATCH', 'Organization wallet needs attention'],
    [503, 'NULL_ORGANIZATION_UNAVAILABLE', 'Organization service unavailable'],
  ] as const) {
    assert.equal((await organizationResponseError(Response.json({ code }, { status }))).title, expected);
  }
  const error = await organizationResponseError(new Response('<html>upstream error</html>', { status: 502 }));
  assert.equal(error.title, 'Organization service unavailable');
  assert.doesNotMatch(error.message, /upstream|html|membership/);
});
