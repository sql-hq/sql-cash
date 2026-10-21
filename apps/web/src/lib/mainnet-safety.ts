export const MAINNET_PAUSED = 'Mainnet transactions are paused until the safety checks and small-value live validation are completed.';
export function assertTransactionsEnabled(enabled: boolean) { if (!enabled) throw new Error(MAINNET_PAUSED); }
export function safeMainnetError(error: unknown): string {
  const code = (error as { code?: number })?.code;
  const message = error instanceof Error ? error.message : '';
  if (code === 4001 || /user rejected|denied|cancelled/i.test(message)) return 'The request was cancelled in your wallet. No automatic retry will be made.';
  if (/insufficient funds|not enough ETH/i.test(message)) return 'Your connected wallet does not have enough ETH for gas.';
  if (/wrong vault password/i.test(message)) return 'Wrong vault password.';
  if (/wallet.*changed|vault changed/i.test(message)) return 'Your wallet or vault changed. Unlock the selected vault and try again.';
  if (/switch.*mainnet|chain.*switch/i.test(message)) return 'Switch the connected wallet to Ethereum mainnet.';
  // Never echo SDK/provider text: even short errors may contain a recovery phrase.
  if (/storage|metadata/i.test(message)) return 'Browser storage is unavailable or the saved data is damaged. Existing data has not been removed. Check browser storage or restore from your backup.';
  if (/backup/i.test(message)) return 'The encrypted backup could not be opened or verified. Check the file and its password, or use your offline recovery phrase.';
  if (/at least 10/i.test(message)) return 'Use a vault password with at least 10 characters.';
  if (/passwords do not match/i.test(message)) return 'The passwords do not match.';
  if (/recovery phrase/i.test(message)) return 'The recovery phrase could not be verified. Check every word and its order.';
  if (/spendable/i.test(message)) return 'The synchronized spendable balance is lower than the requested amount.';
  if (/already in progress|confirmation is not known|transaction submitted/i.test(message)) return 'A transaction is already in progress or awaiting confirmation. Check recent wallet activity before sending again.';
  if (/paused/i.test(message)) return MAINNET_PAUSED;
  if (/sync/i.test(message)) return 'History synchronization is not complete. Check the connection and retry; keep transfers paused.';
  if (/Web Locks|coordinate transactions/i.test(message)) return 'This browser cannot safely coordinate transactions. Use a current browser with Web Locks support.';
  return 'The operation could not be completed. Check your wallet and connection, then try again. No automatic retry will be made.';
}
