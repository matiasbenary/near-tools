'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNearWallet } from 'near-connect-hooks';
import { getTransactionLastResult, JsonRpcProvider } from 'near-api-js';
import { NetworkConfig, type NetworkId, RpcUrls } from '@/config';
import { getLockupAccountId, isMissingAccount, LOCKUP_GAS, LockupPosition } from '@/lib/lockup';
import type { PoolAccount } from '@/lib/staking';
import { stakingMutationKey } from '@/hooks/use-staking';
import { useNetwork } from '@/components/app-providers';

const lockupKey = (ownerId: string, network: NetworkId) => ['lockup', ownerId, network] as const;
// The wallet hook's failover provider logs expected missing-account responses as errors.
const lockupLookupProviders = {
  mainnet: new JsonRpcProvider({ url: RpcUrls.mainnet[0] }),
  testnet: new JsonRpcProvider({ url: RpcUrls.testnet[0] }),
};

export function useLockupPosition(ownerId: string) {
  const { viewFunction } = useNearWallet();
  const { network } = useNetwork();

  return useQuery({
    queryKey: lockupKey(ownerId, network),
    enabled: ownerId.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<LockupPosition | null> => {
      const id = await getLockupAccountId(ownerId, NetworkConfig[network].lockupSuffix);
      let account;
      try {
        account = await lockupLookupProviders[network].viewAccount({
          accountId: id,
          blockQuery: { finality: 'optimistic' },
        });
      } catch (error) {
        if (isMissingAccount(error, id)) return null;
        throw error;
      }

      const actualOwner = (await viewFunction({
        contractId: id,
        method: 'get_owner_account_id',
        args: {},
      })) as string;
      if (actualOwner !== ownerId) return null;

      const [poolId, locked, transferable, transfersEnabled] = await Promise.all([
        viewFunction({ contractId: id, method: 'get_staking_pool_account_id', args: {} }) as Promise<string | null>,
        viewFunction({ contractId: id, method: 'get_locked_amount', args: {} }) as Promise<string>,
        viewFunction({ contractId: id, method: 'get_liquid_owners_balance', args: {} }) as Promise<string>,
        viewFunction({ contractId: id, method: 'are_transfers_enabled', args: {} }) as Promise<boolean>,
      ]);

      const poolAccount = poolId
        ? ((await viewFunction({
            contractId: poolId,
            method: 'get_account',
            args: { account_id: id },
          })) as PoolAccount | null)
        : null;

      return {
        id,
        ownerId,
        poolId,
        poolAccount,
        accountBalance: account.amount,
        lockedBalance: BigInt(locked),
        transferableBalance: BigInt(transferable),
        transfersEnabled,
      };
    },
  });
}

export type LockupAction =
  | { type: 'unstake'; amount?: string }
  | { type: 'withdraw' }
  | { type: 'transfer'; amount: string }
  | { type: 'checkTransfers' };

export function useLockupAction(position: LockupPosition) {
  const { signedAccountId, callFunctionRaw } = useNearWallet();
  const queryClient = useQueryClient();
  const { network } = useNetwork();

  return useMutation({
    mutationKey: [...stakingMutationKey, network, signedAccountId, position.id],
    mutationFn: async (action: LockupAction) => {
      if (signedAccountId !== position.ownerId) throw new Error('Connect the lockup owner account.');
      let outcome;
      if (action.type === 'unstake') {
        if (!position.poolId) throw new Error('No staking pool is selected for this lockup.');
        outcome = await callFunctionRaw({
          contractId: position.id,
          method: action.amount ? 'unstake' : 'unstake_all',
          args: action.amount ? { amount: action.amount } : {},
          gas: LOCKUP_GAS.unstake,
        });
      } else if (action.type === 'withdraw') {
        if (!position.poolId) throw new Error('No staking pool is selected for this lockup.');
        outcome = await callFunctionRaw({
          contractId: position.id,
          method: 'withdraw_all_from_staking_pool',
          args: {},
          gas: LOCKUP_GAS.withdrawAll,
        });
      } else if (action.type === 'transfer') {
        if (!position.transfersEnabled) throw new Error('Transfers are not enabled for this lockup.');
        if (BigInt(action.amount) <= 0n || BigInt(action.amount) > position.transferableBalance) {
          throw new Error('Transfer amount exceeds the available lockup balance.');
        }
        outcome = await callFunctionRaw({
          contractId: position.id,
          method: 'transfer',
          args: { amount: action.amount, receiver_id: signedAccountId },
          gas: LOCKUP_GAS.transfer,
        });
      } else {
        outcome = await callFunctionRaw({
          contractId: position.id,
          method: 'check_transfers_vote',
          args: {},
          gas: LOCKUP_GAS.checkTransfers,
        });
      }
      if (outcome.status === 'Failure' ||
        (typeof outcome.status === 'object' && outcome.status !== null && 'Failure' in outcome.status)) {
        throw new Error('The lockup transaction failed.');
      }
      const result: unknown = getTransactionLastResult(outcome);
      if (action.type !== 'transfer' && result !== true) {
        throw new Error(
          action.type === 'checkTransfers'
            ? 'Transfers are still disabled for this lockup.'
            : 'The lockup operation did not complete.'
        );
      }
      return outcome;
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: lockupKey(position.ownerId, network) }),
        queryClient.invalidateQueries({ queryKey: ['wallet-balance', position.ownerId, network] }),
      ]),
  });
}
