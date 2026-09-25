'use client';

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNearWallet } from 'near-connect-hooks';
import { NetworkConfig } from '@/config';
import { useNetwork } from '@/components/app-providers';
import { GAS } from '@/lib/near';
import { Fee, getValidatorData, PoolAccount, Position, Validator } from '@/lib/staking';

const keys = {
  validators: ['validators'] as const,
  liquidFee: (poolId: string) => ['liquid-fee', poolId] as const,
  walletBalance: (accountId: string) => ['wallet-balance', accountId] as const,
  stakingPools: (accountId: string) => ['staking-pools', accountId] as const,
  liquidBalance: (accountId: string, poolId: string) =>
    ['liquid-balance', accountId, poolId] as const,
  poolAccount: (accountId: string, poolId: string) =>
    ['pool-account', accountId, poolId] as const,
};

export const stakingMutationKey = ['staking-action'] as const;

export function useValidatorData() {
  const { provider, viewFunction } = useNearWallet();
  const { network } = useNetwork();
  const { liquidPools } = NetworkConfig[network];
  const validators = useQuery({
    queryKey: [...keys.validators, network],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      let { pools, fees, apy } = await getValidatorData(network);
      if (pools.length === 0) {
        const { current_validators } = await provider.viewValidators();
        pools = current_validators
          .filter((validator) => validator.account_id.includes('.pool'))
          .sort((a, b) => (BigInt(a.stake) < BigInt(b.stake) ? 1 : -1))
          .map((validator) => ({ id: validator.account_id, liquid: false }));
      }
      return {
        validators: [
          ...liquidPools.map((pool) => ({ id: pool.id, liquid: true })),
          ...pools,
        ] satisfies Validator[],
        fees,
        baseApy: apy,
      };
    },
  });

  const liquidFees = useQueries({
    queries: liquidPools.map((pool) => ({
      queryKey: [...keys.liquidFee(pool.id), network],
      staleTime: 5 * 60 * 1000,
      queryFn: () =>
        viewFunction({
          contractId: pool.id,
          method: 'get_reward_fee_fraction',
          args: {},
        }) as Promise<Fee>,
    })),
  });

  const liquidFeeMap = Object.fromEntries(
    liquidFees.flatMap((query, index) => {
      const fee = query.data;
      return fee && fee.denominator > 0
        ? [[liquidPools[index].id, fee.numerator / fee.denominator]]
        : [];
    })
  );

  return {
    validators: validators.data?.validators ?? [],
    fees: { ...(validators.data?.fees ?? {}), ...liquidFeeMap },
    baseApy: validators.data?.baseApy ?? null,
    error: validators.error ?? liquidFees.find((query) => query.error)?.error ?? null,
    refetch: () =>
      Promise.all([validators.refetch(), ...liquidFees.map((query) => query.refetch())]),
  };
}

export function useWalletBalance(accountId: string) {
  const { provider } = useNearWallet();
  const { network } = useNetwork();
  return useQuery({
    queryKey: [...keys.walletBalance(accountId), network],
    enabled: accountId.length > 0,
    staleTime: 30_000,
    queryFn: async () =>
      (
        await provider.viewAccount({
          accountId,
          blockQuery: { finality: 'optimistic' },
        })
      ).amount.toString(),
  });
}

function useStakingPools(accountId: string) {
  const { network } = useNetwork();
  const { fastNearUrl } = NetworkConfig[network];
  return useQuery({
    queryKey: [...keys.stakingPools(accountId), network],
    enabled: accountId.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const response = await fetch(`${fastNearUrl}/v1/account/${accountId}/staking`);
      if (!response.ok) throw new Error(`Staking positions request failed (${response.status})`);
      const data = (await response.json()) as { pools?: { pool_id: string }[] };
      return data.pools ?? [];
    },
  });
}

export function useStakingPositions(accountId: string, selectedPoolId: string) {
  const { viewFunction } = useNearWallet();
  const { network } = useNetwork();
  const { liquidPools } = NetworkConfig[network];
  const stakingPools = useStakingPools(accountId);
  const poolIds = [
    ...new Set([
      selectedPoolId,
      ...(stakingPools.data ?? []).map((pool) => pool.pool_id),
      ...liquidPools.map((pool) => pool.id),
    ]),
  ].filter(Boolean);

  const poolAccounts = useQueries({
    queries: poolIds.map((poolId) => ({
      queryKey: [...keys.poolAccount(accountId, poolId), network],
      enabled: accountId.length > 0,
      staleTime: 30_000,
      queryFn: () =>
        viewFunction({
          contractId: poolId,
          method: 'get_account',
          args: { account_id: accountId },
        }) as Promise<PoolAccount>,
    })),
  });

  const liquidBalanceQueries = useQueries({
    queries: liquidPools.map((pool) => ({
      queryKey: [...keys.liquidBalance(accountId, pool.id), network],
      enabled: accountId.length > 0,
      staleTime: 30_000,
      queryFn: () =>
        viewFunction({
          contractId: pool.id,
          method: 'ft_balance_of',
          args: { account_id: accountId },
        }) as Promise<string>,
    })),
  });

  const accounts = Object.fromEntries(
    poolAccounts.flatMap((query, index) =>
      query.data ? [[poolIds[index], query.data]] : []
    )
  ) as Record<string, PoolAccount>;
  const liquidBalances = Object.fromEntries(
    liquidBalanceQueries.flatMap((query, index) =>
      query.data !== undefined ? [[liquidPools[index].id, query.data]] : []
    )
  ) as Record<string, string>;
  const positions = (stakingPools.data ?? [])
    .filter((pool) => !liquidPools.some((liquidPool) => liquidPool.id === pool.pool_id))
    .map((pool): Position | null => {
      const account = accounts[pool.pool_id];
      if (!account) return null;
      return {
        id: pool.pool_id,
        staked_balance: BigInt(account.staked_balance),
        unstaked_balance: BigInt(account.unstaked_balance),
        can_withdraw: account.can_withdraw,
      };
    })
    .filter((position): position is Position => position !== null)
    .filter((position) => position.staked_balance > 0n || position.unstaked_balance > 0n);

  return {
    positions,
    accounts,
    liquidBalances,
    error:
      stakingPools.error ??
      poolAccounts.find((query) => query.error)?.error ??
      liquidBalanceQueries.find((query) => query.error)?.error ??
      null,
  };
}

export type StakingAction =
  | { type: 'stake'; amount: string }
  | { type: 'unstake'; amount?: string }
  | { type: 'withdraw' }
  /** minExpected comes from the quote the user reviewed, so we sign exactly that. */
  | { type: 'fastUnstake'; amount: string; minExpected: string };

export function useStakingAction(poolId: string) {
  const { signedAccountId, callFunction } = useNearWallet();
  const { network } = useNetwork();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: [...stakingMutationKey, network, signedAccountId, poolId],
    mutationFn: async (action: StakingAction) => {
      if (action.type === 'stake') {
        return callFunction({
          contractId: poolId,
          method: 'deposit_and_stake',
          gas: GAS.toString(),
          deposit: action.amount,
        });
      }
      if (action.type === 'unstake') {
        return callFunction({
          contractId: poolId,
          method: action.amount ? 'unstake' : 'unstake_all',
          gas: GAS.toString(),
          args: action.amount ? { amount: action.amount } : {},
        });
      }
      if (action.type === 'withdraw') {
        return callFunction({
          contractId: poolId,
          method: 'withdraw_all',
          gas: GAS.toString(),
        });
      }

      return callFunction({
        contractId: poolId,
        method: 'liquid_unstake',
        gas: GAS.toString(),
        args: {
          st_near_to_burn: action.amount,
          min_expected_near: action.minExpected,
        },
      });
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.walletBalance(signedAccountId) }),
        queryClient.invalidateQueries({ queryKey: keys.stakingPools(signedAccountId) }),
        queryClient.invalidateQueries({ queryKey: ['pool-account', signedAccountId] }),
        queryClient.invalidateQueries({ queryKey: ['liquid-balance', signedAccountId] }),
      ]),
  });
}
