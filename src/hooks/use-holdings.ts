'use client';

import { useQuery } from '@tanstack/react-query';
import { useNearWallet } from 'near-connect-hooks';
import { JsonRpcProvider } from 'near-api-js';
import { useNetwork } from '@/components/app-providers';
import { NetworkConfig, RpcUrls } from '@/config';
import { ActionContracts } from '@/lib/actions/contracts';
import {
  DropKey,
  loadDropKeys,
  loadDropName,
  loadStoredDropIds,
} from '@/lib/actions/linkdrop-keys';

export type HeldToken = {
  contractId: string;
  symbol: string;
  decimals: number;
  /** Raw on-chain balance. */
  balance: bigint;
  /** Data-URL icon from ft_metadata, when the token ships one. */
  icon?: string;
};

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

  return useQuery({
    queryKey: ['holdings', network, accountId],
    enabled: accountId.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<HeldToken[]> => {
      const nearBalance = nativeNear(BigInt(await getBalance(accountId)));

      // ponytail: inventory ships balance + metadata in one call — no ft_metadata
      // roundtrips, and no console noise from contracts that panic on NEP-148.
      const response = await fetch(`${NetworkConfig[network].nearBlocksApiUrl}/v1/account/${accountId}/inventory`);
      // ponytail: NearBlocks free tier is ~6 req/min — a miss just means "NEAR only"
      if (!response.ok) return [nearBalance];

      const body = (await response.json()) as {
        inventory?: {
          fts?: {
            contract: string;
            amount: string;
            ft_meta?: { symbol?: string; decimals?: number; icon?: string };
          }[];
        };
      };

      const tokens = (body.inventory?.fts ?? []).flatMap((ft): HeldToken[] => {
        const balance = BigInt(ft.amount ?? '0');
        if (balance === 0n) return [];
        return [
          {
            contractId: ft.contract,
            symbol: ft.ft_meta?.symbol ?? ft.contract,
            decimals: ft.ft_meta?.decimals ?? 24,
            balance,
            icon: ft.ft_meta?.icon ?? undefined,
          },
        ];
      });

      return [nearBalance, ...tokens];
    },
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

export type KeypomDrop = {
  drop_id: string;
  /** near-drop entries reconstructed from browser-held keys have no delete API. */
  locallyManaged?: boolean;
  metadata?: string | null;
  next_key_id?: number;
  /** Present on token drops: those assets have to be refunded before deleting. */
  ft?: unknown;
  nft?: unknown;
  /** Every link this browser holds; `claimed` once the key is gone from the contract. */
  keys?: (DropKey & { claimed: boolean })[];
};

/** Drops this account created, each with the local keys and whether they were claimed. */
export function useDrops(accountId: string) {
  const { viewFunction } = useNearWallet();
  const { network } = useNetwork();
  const linkdrop = ActionContracts[network].linkdrop;
  const keypom = linkdrop.contractId;

  return useQuery({
    queryKey: ['drops', network, accountId],
    enabled: accountId.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      // near-drop has no owner index. Reconstruct this browser's drops from its
      // locally retained secret keys, then keep only keys that remain on-chain.
      if (linkdrop.provider === 'near-drop') {
        const dropIds = loadStoredDropIds(network);
        // The wallet's failover provider logs expected contract panics to
        // console.error, which opens Next's dev overlay even when caught. A
        // direct provider lets a missing/claimed key remain a normal result.
        const directRpc = new JsonRpcProvider({ url: RpcUrls[network][0] });
        const drops = await Promise.all(
          dropIds.map(async (dropId): Promise<KeypomDrop> => {
            const local = loadDropKeys(network, dropId);
            const keys = await Promise.all(
              local.map(async (key) => {
                try {
                  const onChainId = await directRpc.callFunction({
                    contractId: keypom,
                    method: 'get_drop_id_by_key',
                    args: { public_key: key.public },
                  });
                  return { ...key, claimed: String(onChainId) !== dropId };
                } catch {
                  return { ...key, claimed: true };
                }
              })
            );
            const dropName = loadDropName(network, dropId);
            return {
              drop_id: dropId,
              metadata: dropName ? JSON.stringify({ dropName }) : null,
              next_key_id: local.length,
              keys,
              locallyManaged: true,
            };
          })
        );
        return drops;
      }
      const drops = (await viewFunction({
        contractId: keypom,
        method: 'get_drops_for_owner',
        args: { account_id: accountId, from_index: '0', limit: 50 },
      })) as KeypomDrop[];

      // next_key_id only counts keys ever created, so the remaining links are the
      // locally stored keys that the contract still knows about.
      return Promise.all(
        drops.map(async (drop) => {
          const local = loadDropKeys(network, drop.drop_id);
          if (local.length === 0) return drop;
          const onChainKeys = (await viewFunction({
            contractId: keypom,
            method: 'get_keys_for_drop',
            args: { drop_id: drop.drop_id },
          }).catch(() => [])) as { pk: string }[];
          return {
            ...drop,
            keys: local.map((key) => ({
              ...key,
              claimed: !onChainKeys.some((onChain) => onChain.pk === key.public),
            })),
          };
        })
      );
    },
  });
}

/** Deleting a drop refunds into Keypom's own ledger, not straight to the wallet. */
export function useKeypomBalance(accountId: string) {
  const { viewFunction } = useNearWallet();
  const { network } = useNetwork();
  const linkdrop = ActionContracts[network].linkdrop;
  const keypom = linkdrop.contractId;

  return useQuery({
    queryKey: ['keypom-balance', network, accountId],
    enabled: accountId.length > 0,
    queryFn: async () => {
      if (linkdrop.provider === 'near-drop') return '0';
      return ((await viewFunction({
        contractId: keypom,
        method: 'get_user_balance',
        args: { account_id: accountId },
      }).catch(() => '0')) ?? '0') as string;
    },
  });
}
