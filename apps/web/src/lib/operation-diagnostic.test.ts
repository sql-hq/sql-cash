import test from 'node:test';
import assert from 'node:assert/strict';
import { operationDiagnostic } from './operation-diagnostic';

test('wallet diagnostics retain nested rejection codes without logging error payloads', () => {
  const error = Object.assign(new Error('Bearer synthetic-secret and private transaction body'), { name: 'TransactionExecutionError', data: { signature: 'private-signature' }, cause: Object.assign(new Error('private provider response'), { code: 4001 }) });
  const result = operationDiagnostic(error);
  assert.deepEqual(result, [{ name: 'TransactionExecutionError' }, { name: 'Error', code: 4001 }]);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|private|Bearer/);
});

test('wallet diagnostics stop at cyclic causes and discard unsafe identifiers', () => {
  const error: { name: string; code: string; cause?: unknown } = { name: 'Error containing a secret', code: 'Bearer token' }; error.cause = error;
  assert.deepEqual(operationDiagnostic(error), [{ name: 'UnknownError' }]);
});
