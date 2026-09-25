'use client';

import { useState } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import { useNearWallet } from 'near-connect-hooks';
import { yoctoToNear } from 'near-api-js';
import { NetworkConfig } from '@/config';
import { useNetwork } from '@/components/app-providers';
import { errMsg } from '@/lib/errors';
import {
  stakingMutationKey,
  useStakingPositions,
  useValidatorData,
  useWalletBalance,
} from '@/hooks/use-staking';
import { MyPools } from './my-pools';
import { ValidatorList } from './validator-list';
import { PoolCard } from './pool-card';
import { ActivityList } from './result-sheet';

export function StakingConsole() {
  const { signedAccountId } = useNearWallet();
  const { network } = useNetwork();
  const { liquidPools } = NetworkConfig[network];
  const [selectedByUser, setSelectedByUser] = useState<string | null>(null);
  const validatorData = useValidatorData();
  const balance = useWalletBalance(signedAccountId);
  const staking = useStakingPositions(
    signedAccountId,
    selectedByUser ?? validatorData.validators[0]?.id ?? ''
  );
  const busy = useIsMutating({ mutationKey: stakingMutationKey }) > 0;

  const heldLiquidPool = liquidPools.find(
    (pool) =>
      BigInt(staking.liquidBalances[pool.id] ?? '0') > 0n ||
      BigInt(staking.accounts[pool.id]?.unstaked_balance ?? '0') > 0n
  );
  const selected =
    selectedByUser ??
    staking.positions[0]?.id ??
    heldLiquidPool?.id ??
    validatorData.validators[0]?.id ??
    '';
  const account = staking.accounts[selected] ?? null;
  const loadError = staking.error ? errMsg(staking.error) : '';
  const validatorError = validatorData.error ? errMsg(validatorData.error) : '';

  return (
    <div className="stack">
      {loadError && <p className="hint error">{loadError}</p>}
      <MyPools
        positions={staking.positions}
        selected={selected}
        busy={busy}
        liquidBalances={staking.liquidBalances}
        liquidAccounts={staking.accounts}
        onSelect={setSelectedByUser}
      />
      <section className="console">
        <ValidatorList
          validators={validatorData.validators}
          selected={selected}
          busy={busy}
          baseApy={validatorData.baseApy}
          fees={validatorData.fees}
          error={validatorError}
          onRetry={() => void validatorData.refetch()}
          onSelect={setSelectedByUser}
        />
        <div className="side">
          <div className="card">
            <div className="kv">
              <span>Wallet Balance</span>
              <span>
                {balance.data ? `${yoctoToNear(BigInt(balance.data), 2)} Ⓝ` : '—'}
              </span>
            </div>
          </div>
          {selected && (
            <PoolCard
              key={selected}
              poolId={selected}
              account={account}
              balance={balance.data ?? null}
              fee={validatorData.fees[selected]}
              baseApy={validatorData.baseApy}
              liquidBalance={staking.liquidBalances[selected]}
              busy={busy}
            />
          )}
        </div>
      </section>
      <ActivityList />
    </div>
  );
}
