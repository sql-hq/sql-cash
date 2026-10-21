import { decodeFunctionData, encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';

// MetaMask Delegation Framework v1.3.0, including Sepolia:
// https://github.com/MetaMask/delegation-framework/blob/main/documents/Deployments.md
const delegationManager = '0xdb9b1e94b5b69df7e401ddbede43491141047db3';
const redemptionAbi = parseAbi(['function redeemDelegations(bytes[] permissionContexts, bytes32[] modes, bytes[] executionCallDatas)']);
const singleCallMode = `0x${'00'.repeat(32)}`;

/** Exact calldata binding only. Callers must also verify the successful receipt,
 * canonical block and expected pool events/nullifiers. No arbitrary multicalls. */
export function matchesSubmittedCall(transaction: { to: Address | null; input: Hex; value: bigint }, target: Address, data: Hex): boolean {
  if (transaction.value !== 0n) return false;
  if (transaction.to?.toLowerCase() === target.toLowerCase()) return transaction.input.toLowerCase() === data.toLowerCase();
  if (transaction.to?.toLowerCase() !== delegationManager) return false;
  try {
    const decoded = decodeFunctionData({ abi: redemptionAbi, data: transaction.input });
    const [contexts, modes, executions] = decoded.args;
    if (contexts.length !== 1 || modes.length !== 1 || executions.length !== 1 || modes[0] !== singleCallMode) return false;
    // ERC-7579 single execution is packed address(20) + value(32) + calldata.
    const expected = `${target}${'00'.repeat(32)}${data.slice(2)}`.toLowerCase();
    return executions[0]!.toLowerCase() === expected && encodeFunctionData({ abi: redemptionAbi, functionName: 'redeemDelegations', args: decoded.args }).toLowerCase() === transaction.input.toLowerCase();
  } catch { return false; }
}
