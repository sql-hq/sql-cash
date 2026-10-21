// Mainnet constants for SQL's Railgun backend. Kept free of SDK imports so the app can read
// them without loading the (large) Railgun engine.

export const MAINNET_CHAIN_ID = 1 as const;
export const RAILGUN_NETWORK = 'Ethereum' as const; // NetworkName.Ethereum
export const TXID_VERSION = 'V2_PoseidonMerkle' as const; // TXIDVersion.V2_PoseidonMerkle

/** Railgun smart-wallet proxy on Ethereum mainnet (from @railgun-community/shared-models NETWORK_CONFIG). */
export const RAILGUN_PROXY = '0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9' as const;
/** Railgun relay adapt contract on Ethereum mainnet. */
export const RAILGUN_RELAY_ADAPT = '0xac9f360ae85469b27aeddeafc579ef2d052ad405' as const;
/** First block with Railgun state on mainnet; wallet scans never need to start earlier. */
export const RAILGUN_DEPLOYMENT_BLOCK = 14_737_691;

export const USDC = { symbol: 'USDC', decimals: 6, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const };

/** Railgun protocol fee on shield and unshield, in basis points. */
export const RAILGUN_FEE_BPS = 25n;

/** Public Private-Proof-of-Innocence aggregator used by Railgun wallets on mainnet. */
// Current public aggregator documented by RAILGUN; the previous hostname no longer resolves.
// https://docs.railgun.org/developer-guide/wallet/getting-started/5.-start-the-railgun-privacy-engine
export const DEFAULT_POI_NODES = ['https://ppoi.fdi.network'];

/** ENS text record recipients set to their Railgun 0zk address. */
export const ENS_RAILGUN_RECORD = 'railgun';

/** Engine wallet source label (lowercase, at most 16 characters). */
export const WALLET_SOURCE = 'silentquery';

export const DEFAULT_MAINNET_RPCS = ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com'];
