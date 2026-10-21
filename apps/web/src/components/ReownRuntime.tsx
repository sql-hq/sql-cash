import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  createAppKit, useAppKit, useAppKitAccount, useAppKitNetwork,
  useAppKitProvider, useAppKitState, useDisconnect,
} from '@reown/appkit/react';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { mainnet, sepolia } from '@reown/appkit/networks';
import type { EIP1193Provider } from 'viem';
import { config } from '../lib/config';
import { SessionContext } from '../lib/session';
import { identitySession } from '../lib/identity-session';
import { requireWalletAccount, reownUserId } from '../lib/reown-session';
import { activateVaultOwner, lockPrivateVault } from '../lib/vault-safety';

// One instance, outside React. Never initialize with a borrowed/dummy project ID.
const network = config.network === 'mainnet' ? mainnet : sepolia;
createAppKit({
  adapters: [new EthersAdapter()],
  networks: [network],
  defaultNetwork: network,
  projectId: config.reownProjectId!,
  metadata: {
    name: 'Silent Query Layer',
    description: 'Private payouts on Ethereum with Railgun',
    url: window.location.origin,
    icons: [new URL(`${import.meta.env.BASE_URL}logo.svg`, window.location.origin).href],
  },
  features: { analytics: false, email: false, socials: [], swaps: false, onramp: false, send: false },
  themeMode: 'dark',
  themeVariables: { '--w3m-accent': '#5cf2b0' },
});

export function ReownRuntime({ children }: { children: ReactNode }) {
  const { open } = useAppKit();
  const { address, isConnected, status } = useAppKitAccount({ namespace: 'eip155' });
  const { chainId, switchNetwork } = useAppKitNetwork();
  const { walletProvider } = useAppKitProvider<EIP1193Provider>('eip155');
  const { open: walletModalOpen } = useAppKitState();
  const { disconnect } = useDisconnect();
  const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const userId = isConnected ? reownUserId(address) : null;
  // Replacing this ID synchronously prevents an old async signing callback from
  // returning a provider after the user changed/disconnected their wallet.
  const currentId = useRef(userId); currentId.current = userId;
  const authenticated = !!userId && userId !== disconnectingId && !signingOut;
  useLayoutEffect(() => {
    activateVaultOwner(authenticated ? userId : null);
    return () => activateVaultOwner(null);
  }, [authenticated, userId]);
  useEffect(() => {
    if (!walletProvider) return;
    const accountsChanged = (accounts: string[]) => {
      if (reownUserId(accounts[0]) !== currentId.current) { currentId.current = null; activateVaultOwner(null); }
    };
    const disconnected = () => { currentId.current = null; activateVaultOwner(null); };
    const chainChanged = () => lockPrivateVault();
    walletProvider.on('accountsChanged', accountsChanged);
    walletProvider.on('chainChanged', chainChanged);
    walletProvider.on('disconnect', disconnected);
    return () => {
      walletProvider.removeListener('accountsChanged', accountsChanged);
      walletProvider.removeListener('chainChanged', chainChanged);
      walletProvider.removeListener('disconnect', disconnected);
    };
  }, [walletProvider]);
  useEffect(() => {
    let lastActivity = Date.now();
    const activity = () => { lastActivity = Date.now(); };
    const lock = () => lockPrivateVault();
    window.addEventListener('pointerdown', activity); window.addEventListener('keydown', activity); window.addEventListener('pagehide', lock);
    const timer = setInterval(() => { if (Date.now() - lastActivity > 10 * 60_000) lockPrivateVault(); }, 30_000);
    return () => { clearInterval(timer); window.removeEventListener('pointerdown', activity); window.removeEventListener('keydown', activity); window.removeEventListener('pagehide', lock); };
  }, []);
  const connecting = status === 'connecting' || status === 'reconnecting';
  const connect = () => {
    setError(''); setDisconnectingId(null);
    void open({ view: 'Connect', namespace: 'eip155' }).catch(() => {
      setError('The wallet connection could not be opened. Please try again.');
    });
  };
  async function getEvmProvider(selected: string) {
    const selectedId = reownUserId(selected);
    if (!authenticated || !walletProvider || !selectedId || selectedId !== currentId.current || selectedId === disconnectingId) {
      throw new Error('Connect the selected Ethereum wallet first.');
    }
    await requireWalletAccount(walletProvider, selected);
    if (selectedId !== currentId.current) throw new Error('Your wallet changed. Try again with the connected account.');
    return walletProvider;
  }
  async function switchConnectedNetwork(selected: string) {
    const provider = await getEvmProvider(selected);
    await switchNetwork(network);
    await requireWalletAccount(provider, selected);
    const actualChain = await provider.request({ method: 'eth_chainId' });
    if (currentId.current !== reownUserId(selected) || Number(actualChain) !== config.targetChainId) {
      throw new Error('Switch your wallet to the selected Ethereum network and try again.');
    }
  }
  async function signOut() {
    lockPrivateVault();
    setSigningOut(true); setError('');
    const leavingId = userId;
    try {
      if (leavingId) await identitySession.clear(leavingId);
      if (currentId.current !== leavingId) throw new Error('The connected account changed during sign-out.');
      await disconnect({ namespace: 'eip155' });
      // Do not log out a different wallet if the account changed during cleanup.
      if (currentId.current === leavingId || !currentId.current) {
        setDisconnectingId(leavingId); window.location.hash = '';
      }
    } catch { setError('We could not disconnect your wallet. Please try again.'); }
    finally { setSigningOut(false); }
  }
  const numericChain = Number(chainId);
  return <SessionContext.Provider value={{
    configured: true, ready: !connecting, authenticated, userId: authenticated ? userId : null,
    label: authenticated ? `${address!.slice(0, 6)}…${address!.slice(-4)}` : 'Reown wallet',
    walletAddresses: authenticated ? [address!] : [], walletsReady: !connecting,
    evmWallets: authenticated ? [{ address: address!, chainId: Number.isFinite(numericChain) ? numericChain : null, client: 'reown' }] : [],
    walletModalOpen, error, signingOut, signIn: connect, signOut,
    connectWallet: connect, switchNetwork: switchConnectedNetwork, getEvmProvider,
  }}>{children}</SessionContext.Provider>;
}
