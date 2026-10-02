'use client';

import { useState } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import { useNearWallet } from 'near-connect-hooks';
import { NetworkConfig } from '@/config';
import { useNetwork } from '@/components/app-providers';
import { errMsg } from '@/lib/errors';
import { withoutStakingDust } from '@/lib/staking';
import { stakingMutationKey } from '@/hooks/use-staking';
import type { PositionSelection } from '@/lib/selection';
import { useLockupPosition } from '@/hooks/use-lockup';
import {
  useStakingPositions,
  useValidatorData,
  useWalletBalance,
} from '@/hooks/use-staking';
import { MyPools } from './my-pools';
import { ValidatorList } from './validator-list';
import { PoolCard } from './pool-card';
import { LockupCard } from './lockup-card';
import { ActivityList } from './result-sheet';

export function StakingConsole() {
  const { signedAccountId } = useNearWallet();
  const { network } = useNetwork();
  const { liquidPools } = NetworkConfig[network];
  const [selectedByUser, setSelectedByUser] = useState<PositionSelection | null>(null);
  const validatorData = useValidatorData();
  const balance = useWalletBalance(signedAccountId);
  const lockup = useLockupPosition(signedAccountId);
  const staking = useStakingPositions(
    signedAccountId,
    selectedByUser?.kind === 'pool' ? selectedByUser.poolId : liquidPools[0]?.id ?? validatorData.validators[0]?.id ?? ''
  );
  const busy = useIsMutating({ mutationKey: stakingMutationKey }) > 0;

  const heldLiquidPool = liquidPools.find(
    (pool) =>
      withoutStakingDust(BigInt(staking.liquidBalances[pool.id] ?? '0')) > 0n ||
      withoutStakingDust(BigInt(staking.accounts[pool.id]?.unstaked_balance ?? '0')) > 0n
  );
  const lockupPosition = lockup.data ?? null;
  const selected: PositionSelection = selectedByUser ??
    (staking.positions[0]
      ? { kind: 'pool', poolId: staking.positions[0].id }
      : heldLiquidPool
        ? { kind: 'pool', poolId: heldLiquidPool.id }
        : lockupPosition
          ? { kind: 'lockup', lockupId: lockupPosition.id }
          : { kind: 'pool', poolId: liquidPools[0]?.id ?? validatorData.validators[0]?.id ?? '' });
  const account = selected.kind === 'pool' ? staking.accounts[selected.poolId] ?? null : null;
  const loadError = staking.error ? errMsg(staking.error) : lockup.error ? errMsg(lockup.error) : '';
  const validatorError = validatorData.error ? errMsg(validatorData.error) : '';

  return (
    <div className="stack staking-console">
      {loadError && <p className="hint error">{loadError}</p>}
      <MyPools
        positions={staking.positions}
        lockup={lockupPosition}
        selected={selected}
        busy={busy}
        liquidBalances={staking.liquidBalances}
        liquidAccounts={staking.accounts}
        onSelect={setSelectedByUser}
      />
      <section className="management-workspace">
        <div className="console">
          <div className="workspace-column">
            <ValidatorList
              validators={validatorData.validators}
              selected={selected.kind === 'pool' ? selected.poolId : ''}
              busy={busy}
              baseApy={validatorData.baseApy}
              fees={validatorData.fees}
              error={validatorError}
              onRetry={() => void validatorData.refetch()}
              onSelect={(poolId) => setSelectedByUser({ kind: 'pool', poolId })}
            />
          </div>
          <aside className="side action-panel">
            <h2 className="section-label">Stake &amp; Manage</h2>
            {selected.kind === 'lockup' && lockupPosition ? (
              <LockupCard key={lockupPosition.id} position={lockupPosition} busy={busy} />
            ) : selected.kind === 'pool' && selected.poolId ? (
              <PoolCard
                key={selected.poolId}
                poolId={selected.poolId}
                account={account}
                balance={balance.data ?? null}
                fee={validatorData.fees[selected.poolId]}
                baseApy={validatorData.baseApy}
                liquidBalance={staking.liquidBalances[selected.poolId]}
                busy={busy}
              />
            ) : null}
          </aside>
        </div>
      </section>
      <ActivityList />
    </div>
  );
}
