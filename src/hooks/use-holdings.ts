'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNearWallet } from 'near-connect-hooks';
import { JsonRpcProvider } from 'near-api-js';
import { useNetwork } from '@/components/app-providers';
import { NetworkConfig, RpcUrls } from '@/config';
import { ActionContracts } from '@/lib/actions/contracts';
import { DropKey, loadDropKeys, loadDropName, loadStoredDropIds } from '@/lib/actions/linkdrop-keys';

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

      // Legacy tokens (near-sdk 3.x) emit no events, so NearBlocks never sees a burn or an
      // unregister and keeps showing the old balance. Confirm each one on-chain.
      // ponytail: one view per token, 10 at a time; fine for tens of tokens
      const directRpc = new JsonRpcProvider({ url: RpcUrls[network][0] });
      const confirmed: HeldToken[] = [];
      for (let i = 0; i < tokens.length; i += 10)
        await Promise.all(
          tokens.slice(i, i + 10).map(async (token) => {
            const onChain = await directRpc
              .callFunction({ contractId: token.contractId, method: 'ft_balance_of', args: { account_id: accountId } })
              .then((b) => BigInt(b as string), () => token.balance);
            if (onChain > 0n) confirmed.push({ ...token, balance: onChain });
          })
        );

      return [nearBalance, ...tokens.flatMap((t) => confirmed.filter((c) => c.contractId === t.contractId))];
    },
  });
}

export type FtStorage = {
  /** Contracts on the Ref Finance whitelist. */
  verified: Set<string>;
  /** NEAR locked as storage in each empty or unverified token this account is registered with. */
  locked: Map<string, bigint>;
  /** Registered tokens with a zero balance — NearBlocks' inventory leaves them out. */
  empty: string[];
};

/** Which tokens are verified, and which registrations can be removed to get their storage NEAR back. */
export function useFtStorage(accountId: string, held: HeldToken[] = []) {
  const { viewFunction } = useNearWallet();
  const { network } = useNetwork();
  const queryClient = useQueryClient();
  // NearBlocks' inventory can hold tokens FastNEAR's list misses; check their storage too.
  const heldIds = held.map((t) => t.contractId).filter((id) => id !== 'near');

  return useQuery({
    queryKey: ['ft-storage', network, accountId, heldIds],
    enabled: accountId.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<FtStorage> => {
      // ponytail: sub-results cached in the QueryClient, so a refetch (focus, held list arriving)
      // only hits the network for what expired. In-memory only; persist-client if reloads hurt.
      const [list, whitelist] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: ['ft-storage', network, accountId, 'list'],
          staleTime: 5 * 60_000,
          // FastNEAR lists every token the account touched, zero balances included.
          queryFn: async () => {
            const response = await fetch(`${NetworkConfig[network].fastNearUrl}/v1/account/${accountId}/ft`);
            if (!response.ok) throw new Error(`FastNEAR token list failed (${response.status})`);
            return response.json() as Promise<{ tokens?: { contract_id: string; balance: string }[] }>;
          },
        }),
        queryClient.fetchQuery({
          queryKey: ['ft-whitelist', network],
          staleTime: 60 * 60_000,
          queryFn: () =>
            viewFunction({
              contractId: NetworkConfig[network].verifiedTokens,
              method: 'get_whitelisted_tokens',
            }) as Promise<string[]>,
        }),
      ]);
      const verified = new Set(whitelist);
      const listed = list.tokens ?? [];
      const missing = heldIds
        .filter((id) => !listed.some((t) => t.contract_id === id))
        .map((contract_id) => ({ contract_id, balance: '' }));
      const candidates = [...listed, ...missing].filter((t) => t.balance === '0' || !verified.has(t.contract_id));

      // Direct provider: a contract without NEP-145 panics, which the wallet's provider logs as an error.
      const directRpc = new JsonRpcProvider({ url: RpcUrls[network][0] });
      const locked = new Map<string, bigint>();
      // ponytail: 10 calls at a time keeps the free RPC from rate-limiting; an account with hundreds of tokens takes a few seconds
      for (let i = 0; i < candidates.length; i += 10)
        await Promise.all(
          candidates.slice(i, i + 10).map(async (t) => {
            const total = await queryClient.fetchQuery({
              queryKey: ['ft-storage', network, accountId, 'of', t.contract_id],
              staleTime: 5 * 60_000,
              queryFn: () => lockedStorage(directRpc, t.contract_id, accountId),
            });
            if (total !== null) locked.set(t.contract_id, total);
          })
        );

      return {
        verified,
        locked,
        empty: candidates.filter((t) => t.balance === '0' && locked.has(t.contract_id)).map((t) => t.contract_id),
      };
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
  /** Uses with an asset still deposited; refund_assets panics when it is 0. */
  registered_uses?: number;
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

/** NEAR locked in `contractId`'s storage for `accountId`, or null when there's nothing removable. */
async function lockedStorage(rpc: JsonRpcProvider, contractId: string, accountId: string): Promise<bigint | null> {
  const storage = (await rpc
    .callFunction({ contractId, method: 'storage_balance_of', args: { account_id: accountId } })
    .catch(() => null)) as { total?: string } | null;
  if (!storage?.total) return null;
  // Some NEP-145 tokens (e.g. cb.tkn.primitives.near) skip storage_unregister. A view call
  // tells them apart: a real one panics asking for 1 yocto, a missing one is MethodNotFound.
  const unregisterable = await rpc
    .callFunction({ contractId, method: 'storage_unregister', args: {} })
    .then(() => true, (error: unknown) => !String(error).includes('MethodNotFound'));
  return unregisterable ? BigInt(storage.total) : null;
}
