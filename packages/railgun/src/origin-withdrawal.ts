import { USDC } from './network';

export type OriginWithdrawalQuote = { shieldTxid: `0x${string}`; to: `0x${string}`; amount: bigint };
export function validateShieldTransactionHash(hash: string) {
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('Enter the original Ethereum deposit transaction hash.');
}
export function originQuoteFromRecipients(
  hash: string,
  recipients: readonly { tokenAddress: string; recipientAddress: string; amount: bigint }[],
  nfts: readonly unknown[],
): OriginWithdrawalQuote {
  validateShieldTransactionHash(hash);
  if (recipients.length !== 1 || nfts.length || recipients[0].tokenAddress.toLowerCase() !== USDC.address.toLowerCase()) {
    throw new Error('This return supports an unspent USDC-only deposit.');
  }
  const { recipientAddress: to, amount } = recipients[0];
  if (!/^0x[0-9a-f]{40}$/i.test(to) || /^0x0{40}$/i.test(to) || typeof amount !== 'bigint' || amount <= 0n || amount >= 2n ** 256n) {
    throw new Error('The original deposit has no valid returnable USDC.');
  }
  return { shieldTxid: hash.toLowerCase() as `0x${string}`, to: to as `0x${string}`, amount };
}
export function assertOriginQuoteUnchanged(reviewed: OriginWithdrawalQuote, current: OriginWithdrawalQuote) {
  if (reviewed.shieldTxid.toLowerCase() !== current.shieldTxid.toLowerCase() ||
      reviewed.to.toLowerCase() !== current.to.toLowerCase() || reviewed.amount !== current.amount) {
    throw new Error('Return details changed. Check the deposit again.');
  }
}
