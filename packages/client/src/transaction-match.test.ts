import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import { matchesSubmittedCall } from './transaction-match';

const target = `0x${'11'.repeat(20)}` as const, data = '0x12345678aabb' as const;
const manager = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3' as const;
const mode = `0x${'00'.repeat(32)}` as Hex;
const abi = parseAbi(['function redeemDelegations(bytes[] permissionContexts, bytes32[] modes, bytes[] executionCallDatas)']);
const execution = `${target}${'00'.repeat(32)}${data.slice(2)}` as Hex;
function wrapped(modes: Hex[] = [mode], executions: Hex[] = [execution], contexts: Hex[] = ['0x']) {
  return { to: manager, value: 0n, input: encodeFunctionData({ abi, functionName: 'redeemDelegations', args: [contexts, modes, executions] }) };
}
test('direct and one exact default-mode MetaMask execution retain calldata binding', () => {
  assert.equal(matchesSubmittedCall({ to: target, input: data, value: 0n }, target, data), true);
  assert.equal(matchesSubmittedCall(wrapped(), target, data), true);
});
test('wallet wrappers reject changed target, value, calldata, mode and additional calls', () => {
  for (const transaction of [
    { ...wrapped(), to: target }, { ...wrapped(), to: null }, { ...wrapped(), value: 1n },
    { ...wrapped(), input: `${wrapped().input}00` as Hex }, { ...wrapped(), input: '0x1234' as Hex },
    wrapped([`0x01${'00'.repeat(31)}`]), wrapped([`0x0001${'00'.repeat(30)}`]),
    wrapped([mode, mode], [execution, execution], ['0x', '0x']),
    wrapped([mode], [`0x${'22'.repeat(20)}${execution.slice(42)}`]),
    wrapped([mode], [`${target}${'00'.repeat(31)}01${data.slice(2)}`]),
    wrapped([mode], [`${execution}ff`]), wrapped([mode], [execution], []),
  ]) assert.equal(matchesSubmittedCall(transaction, target, data), false);
});
test('direct calls still reject changed calldata and native value', () => {
  assert.equal(matchesSubmittedCall({ to: target, input: '0x1234', value: 0n }, target, data), false);
  assert.equal(matchesSubmittedCall({ to: target, input: data, value: 1n }, target, data), false);
});
