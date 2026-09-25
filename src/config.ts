export type NetworkId = 'mainnet' | 'testnet';

export const DefaultNetwork: NetworkId = 'mainnet';

export const RpcUrls: Record<NetworkId, string[]> = {
  mainnet: ['https://free.rpc.fastnear.com'],
  testnet: ['https://test.rpc.fastnear.com'],
};

export type LiquidPool = {
  id: string;
  token: string;
  fastExit?:
    | { type: 'metapool' }
    | { type: 'external'; url: string; label: string };
};

export const NetworkConfig: Record<
  NetworkId,
  {
    fastNearUrl: string;
    nearBlocksApiUrl: string;
    liquidPools: LiquidPool[];
    explorerUrl: string;
    explorerBase: string;
  }
> = {
  mainnet: {
    fastNearUrl: 'https://api.fastnear.com',
    nearBlocksApiUrl: 'https://api.nearblocks.io',
    explorerUrl: 'https://nearblocks.io/validators',
    explorerBase: 'https://nearblocks.io',
    liquidPools: [
      { id: 'meta-pool.near', token: 'stNEAR', fastExit: { type: 'metapool' } },
      {
        id: 'linear-protocol.near',
        token: 'LiNEAR',
        fastExit: {
          type: 'external',
          url: 'https://app.linearprotocol.org/?tab=unstake',
          label: 'LiNEAR',
        },
      },
    ],
  },
  testnet: {
    fastNearUrl: 'https://test.api.fastnear.com',
    nearBlocksApiUrl: 'https://api-testnet.nearblocks.io',
    explorerUrl: 'https://testnet.nearblocks.io/validators',
    explorerBase: 'https://testnet.nearblocks.io',
    liquidPools: [],
  },
};

export const txUrl = (network: NetworkId, hash: string) =>
  `${NetworkConfig[network].explorerBase}/txns/${hash}`;
