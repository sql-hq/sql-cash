import deployment from '../../public/deployment.json';

const configuredRelayerUrl = import.meta.env.VITE_RELAYER_URL as string | undefined;
// A production visitor cannot reach the development machine's relayer.
const localRelayer = configuredRelayerUrl && /^https?:\/\/(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::|\/|$)/i.test(configuredRelayerUrl);
const rpcUrl = (import.meta.env.VITE_RPC_URL || 'https://0xrpc.io/sep') as string;
const rpcFallbacks = (import.meta.env.VITE_RPC_FALLBACK_URLS ?? 'https://ethereum-sepolia-rpc.publicnode.com') as string;

/**
 * Network the console runs on. Mainnet (default) uses the Railgun privacy system on Ethereum;
 * "sepolia" keeps the legacy SQL pool for testing.
 */
export type SqlNetwork = 'mainnet' | 'sepolia';
const network: SqlNetwork = (import.meta.env.VITE_SQL_NETWORK as string | undefined) === 'sepolia' ? 'sepolia' : 'mainnet';
// Hosted builds use the server-side transport. Never put a paid-provider secret in VITE_.
const mainnetRpcUrls = import.meta.env.VITE_MAINNET_RPC_PROXY === 'true'
  ? [new URL(`${import.meta.env.BASE_URL}rpc/mainnet`, window.location.origin).href]
  : ((import.meta.env.VITE_MAINNET_RPC_URLS as string | undefined) || 'https://ethereum-rpc.publicnode.com,https://eth.llamarpc.com')
    .split(',').map(url => url.trim()).filter(Boolean);

export const config = {
  network,
  /** Chain the user's EVM wallet must be on to move funds. */
  targetChainId: network === 'mainnet' ? 1 : 11155111,
  mainnetRpcUrls,
  mainnetTransactionsEnabled: import.meta.env.VITE_ENABLE_MAINNET_TRANSACTIONS === 'true',
  chainId: 11155111n,
  defaultEnvironment: 'testnet' as const,
  reownProjectId: (import.meta.env.VITE_REOWN_PROJECT_ID as string | undefined)?.trim(),
  rpcUrl,
  rpcUrls: [...new Set([rpcUrl, ...rpcFallbacks.split(',').map(url => url.trim()).filter(Boolean)])],
  graphUrl: import.meta.env.VITE_GRAPH_URL as string | undefined,
  relayerUrl: import.meta.env.PROD && localRelayer ? undefined : configuredRelayerUrl,
  poolAddress: deployment.contracts.nullPool as `0x${string}`,
  manifestUrl: '/deployment.json',
  confirmations: Math.max(1, Number(import.meta.env.VITE_CONFIRMATIONS || '3')),
};

// A local namespace for cryptographic sandbox artifacts; this is not a deployment.
export const sandboxContext = { chainId: 11155111n, poolAddress: '0x0000000000000000000000000000000000000001' as const };
export const protocolContext = config.poolAddress ? { chainId: config.chainId, poolAddress: config.poolAddress } : null;
