import { createContext, useContext } from 'react';

export type Session = {
  configured: boolean;
  ready: boolean;
  authenticated: boolean;
  userId: string | null;
  label: string;
  walletAddresses?: string[];
  walletsReady?: boolean;
  error: string;
  signingOut: boolean;
  walletModalOpen?: boolean;
  /** External EVM wallets the user connected (MetaMask, Coinbase, WalletConnect…), excluding embedded ones. */
  evmWallets?: { address: string; chainId: number | null; client: string }[];
  connectWallet?: () => void;
  /** Switches the wallet to config.targetChainId. */
  switchNetwork?: (address: string) => Promise<void>;
  /** EIP-1193 provider of a connected external wallet, used to sign Railgun shield/transfer transactions. */
  getEvmProvider?: (address: string) => Promise<unknown>;
  signIn: () => void;
  signOut: () => Promise<void>;
};

export const SessionContext = createContext<Session>({ configured: false, ready: true, authenticated: false, userId: null, label: '', error: '', signingOut: false, signIn: () => {}, signOut: async () => {} });
export function useSession() { return useContext(SessionContext); }
