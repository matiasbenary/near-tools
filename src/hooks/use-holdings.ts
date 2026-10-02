'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNearWallet } from 'near-connect-hooks';
import { JsonRpcProvider } from 'near-api-js';
import { useNetwork } from '@/components/app-providers';
import { NetworkConfig, RpcUrls } from '@/config';
import { ActionContracts } from '@/lib/actions/contracts';
import { dropData, dropReady, type OnChainDrop } from '@/lib/actions/linkdrop';
import { DropKey, loadDropKeys, loadDropName, loadStoredDropIds } from '@/lib/actions/linkdrop-keys';

import { loadHoldings, saveHoldings, readTokenHoldings, limitTokenRequests, type HeldToken, type TokenMetadata } from '@/lib/holdings';
export type { HeldToken } from '@/lib/holdings';

/** NEAR itself is always first in the picker, so a drop needs no token at all. */
export const nativeNear = (balance: bigint): HeldToken => ({
  contractId: 'near',
  symbol: 'NEAR',
  decimals: 24,
  balance,
});

/**
 * The tokens this account actually holds, so a linkdrop picks from a list
 * instead of asking the user to type a contract ID and find out after signing.
 */
export function useHoldings(accountId: string) {
  const { getBalance } = useNearWallet();
  const { network } = useNetwork();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ['holdings', network, accountId],
    initialData: () => loadHoldings(network, accountId),
    initialDataUpdatedAt: 0,
    enabled: accountId.length > 0,
    staleTime: 60_000,
    queryFn: async ({ signal }): Promise<HeldToken[]> => {
      const nearBalance = nativeNear(BigInt(await getBalance(accountId)));

      const rpc = new JsonRpcProvider({ url: RpcUrls[network][0] });
      const tokens = await readTokenHoldings({
        known: queryClient.getQueryData<HeldToken[]>(['holdings', network, accountId])
          ?? loadHoldings(network, accountId) ?? [],
        sources: [
          fetch(`${NetworkConfig[network].nearBlocksApiUrl}/v1/account/${accountId}/inventory`, { signal })
            .then(async (response) => {
              if (!response.ok) throw new Error(`NearBlocks token list failed (${response.status})`);
              const body = await response.json() as { inventory?: { fts?: { contract: string; amount?: string; ft_meta?: TokenMetadata }[] } };
              if (!body.inventory || !Array.isArray(body.inventory.fts)) throw new Error('Invalid NearBlocks inventory');
              return body.inventory.fts.map((ft) => ({ contractId: ft.contract, balance: ft.amount, metadata: ft.ft_meta }));
            }),
          fetch(`${NetworkConfig[network].fastNearUrl}/v1/account/${accountId}/ft`, { signal })
            .then(async (response) => {
              if (!response.ok) throw new Error(`FastNEAR token list failed (${response.status})`);
              const body = await response.json() as { tokens?: { contract_id: string }[] };
              if (!Array.isArray(body.tokens)) throw new Error('Invalid FastNEAR token list');
              return body.tokens.map((ft) => ({ contractId: ft.contract_id }));
            }),
        ],
        balanceOf: async (contractId) => BigInt(await limitTokenRequests(() => rpc.callFunction({ contractId,
          method: 'ft_balance_of', args: { account_id: accountId } })) as string),
        metadataOf: (contractId) => limitTokenRequests(() => rpc.callFunction({ contractId, method: 'ft_metadata', args: {} })) as Promise<TokenMetadata>,
        registered: async (contractId) => {
          const balance = await limitTokenRequests(() => rpc.callFunction({ contractId, method: 'storage_balance_of',
            args: { account_id: accountId } })).catch((error: unknown) => {
              if (/MethodNotFound/.test(String(error))) return null;
              throw error;
            }) as { total?: string } | null;
          return BigInt(balance?.total ?? '0') > 0n;
        },
      });
      const result = [nearBalance, ...tokens];
      if (signal.aborted) throw new Error('Holdings refresh was cancelled.');
      saveHoldings(network, accountId, result);
      return result;
    },
  });
}

/** Verification is the only prerequisite for removing a nonempty token. */
export function useFtVerification(accountId: string) {
  const { network } = useNetwork();
  return useQuery({
    queryKey: ['ft-whitelist', network],
    enabled: accountId.length > 0,
    staleTime: 60 * 60_000,
    queryFn: () => limitTokenRequests(() => new JsonRpcProvider({ url: RpcUrls[network][0] }).callFunction({
      contractId: NetworkConfig[network].verifiedTokens, method: 'get_whitelisted_tokens', args: {},
    })) as Promise<string[]>,
  });
}

export type OwnedNft = {
  token_id: string;
  owner_id?: string;
  metadata?: { title?: string; media?: string };
};

/** The NFTs this account holds in the shared collection — one query, one cache entry. */
export function useOwnedNfts(accountId: string) {
  const { viewFunction } = useNearWallet();
  const { network } = useNetwork();

  return useQuery({
    queryKey: ['owned-nfts', network, accountId],
    enabled: accountId.length > 0,
    staleTime: 60_000,
    queryFn: async () =>
      (await viewFunction({
        contractId: ActionContracts[network].nft.contractId,
        method: 'nft_tokens_for_owner',
        args: { account_id: accountId, from_index: '0', limit: 50 },
      })) as OwnedNft[],
  });
}

export type Linkdrop = {
  drop_id: string;
  name: string;
  exists: boolean;
  ready: boolean;
  keys: (DropKey & { claimed: boolean })[];
};

/** The contract has no owner index; discover drops from scoped local records. */
export function useDrops(accountId: string) {
  const { network } = useNetwork();
  const contractId = ActionContracts[network].linkdrop.contractId;
  const scope = { network, contractId, accountId };
  return useQuery({
    queryKey: ['drops', network, accountId, contractId],
    enabled: accountId.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const rpc = new JsonRpcProvider({ url: RpcUrls[network][0] });
      const missing = (error: unknown) => /No drop information for such drop_id|No drop for public key/.test(String(error));
      const drops = await Promise.all(loadStoredDropIds(scope).map(async (dropId): Promise<Linkdrop | null> => {
        const drop = await rpc.callFunction({ contractId, method: 'get_drop_by_id',
          args: { drop_id: Number(dropId) } }).catch((error: unknown) => {
            if (missing(error)) return null;
            throw error;
          }) as OnChainDrop | null;
        if (drop && dropData(drop).funder !== accountId) return null;
        const keys = await Promise.all(loadDropKeys(scope, dropId).map(async (key) => {
          if (!drop) return { ...key, claimed: true };
          try {
            const id = await rpc.callFunction({ contractId, method: 'get_drop_id_by_key', args: { public_key: key.public } });
            return { ...key, claimed: String(id) !== dropId };
          } catch (error) {
            if (missing(error)) return { ...key, claimed: true };
            throw error;
          }
        }));
        return { drop_id: dropId, name: loadDropName(scope, dropId), exists: !!drop,
          ready: !!drop && dropReady(drop), keys };
      }));
      return drops.filter((drop): drop is Linkdrop => drop !== null);
    },
  });
}

