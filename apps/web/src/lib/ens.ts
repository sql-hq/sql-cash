import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { config } from './config';

export const ensClient = createPublicClient({ chain: sepolia, transport: http(config.rpcUrl, { timeout: 15_000, retryCount: 1 }), cacheTime: 0 });
