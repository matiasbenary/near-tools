import { NetworkConfig } from '@/config';
import { useNetwork } from '@/components/app-providers';
import type { LockupPosition } from '@/lib/lockup';
import { PositionSelection, sameSelection } from '@/lib/selection';
import {
  formatNearBalance,
  formatTokenBalance,
  PoolAccount,
  Position,
  withoutStakingDust,
} from '@/lib/staking';

export function MyPools({
  positions,
  lockup,
  selected,
  busy,
  liquidBalances,
  liquidAccounts,
  onSelect,
}: {
  positions: Position[];
  lockup: LockupPosition | null;
  selected: PositionSelection;
  busy: boolean;
  liquidBalances: Record<string, string>;
  liquidAccounts: Record<string, PoolAccount | undefined>;
  onSelect: (selection: PositionSelection) => void;
}) {
  const { network } = useNetwork();
  const activeLiquidPools = NetworkConfig[network].liquidPools.filter((pool) => {
    const tokenBalance = withoutStakingDust(BigInt(liquidBalances[pool.id] ?? '0'));
    const unstakedBalance = withoutStakingDust(
      BigInt(liquidAccounts[pool.id]?.unstaked_balance ?? '0')
    );
    return tokenBalance > 0n || unstakedBalance > 0n;
  });
  if (positions.length === 0 && activeLiquidPools.length === 0 && !lockup) return (
    <section className="card empty-state">
      <h2>You have no stake yet</h2>
      <p>Pick a validator below, enter an amount, and review the transaction before it reaches your wallet. Rewards start accruing from the next epoch (~12 h).</p>
    </section>
  );
  const totalDirectStaked = positions.reduce((s, p) => s + p.staked_balance, 0n);
  const totalLiquidStaked = activeLiquidPools.reduce(
    (sum, pool) =>
      sum + withoutStakingDust(BigInt(liquidAccounts[pool.id]?.staked_balance ?? '0')),
    0n
  );
  const lockupStaked = BigInt(lockup?.poolAccount?.staked_balance ?? '0');
  const lockupUnstaked = BigInt(lockup?.poolAccount?.unstaked_balance ?? '0');
  const totalStaked = totalDirectStaked + totalLiquidStaked + lockupStaked;
  const totalDirectUnstaked = positions.reduce((s, p) => s + p.unstaked_balance, 0n);
  const totalLiquidUnstaked = activeLiquidPools.reduce(
    (sum, pool) =>
      sum + withoutStakingDust(BigInt(liquidAccounts[pool.id]?.unstaked_balance ?? '0')),
    0n
  );
  const totalUnstaked = totalDirectUnstaked + totalLiquidUnstaked + lockupUnstaked;
  const totalBalance = totalStaked + totalUnstaked;
  const positionCount = positions.length + activeLiquidPools.length + (lockup ? 1 : 0);
  const lockupSelected =
    !!lockup && sameSelection(selected, { kind: 'lockup', lockupId: lockup.id });
  return (
    <section className="staking-overview" aria-labelledby="staking-overview-title">
      <div className="staking-overview-summary">
        <h2 className="section-label" id="staking-overview-title">
          My Staking
        </h2>
        <p className="staking-total">{formatNearBalance(totalBalance)}</p>
        <p className="staking-total-label">Total staking balance</p>
        <p className="staking-overview-meta">
          {positionCount} {positionCount === 1 ? 'position' : 'positions'}
          {totalUnstaked > 0n && ` · ${formatNearBalance(totalUnstaked)} unstaking`}
        </p>
      </div>
      <div className="staking-position-list">
        {lockup && (
          <button
            key={lockup.id}
            className={`vrow${lockupSelected ? ' active' : ''}`}
            disabled={busy}
            aria-pressed={lockupSelected}
            onClick={() => onSelect({ kind: 'lockup', lockupId: lockup.id })}
          >
            <span className="grow">
              {lockup.poolId ?? 'Lockup funds'}{' '}
              <span className="badge lockup-badge">Lockup</span>
            </span>
            {lockupUnstaked > 0n && (
              <span className="num dim">
                {formatNearBalance(lockupUnstaked)}{' '}
                {lockup.poolAccount?.can_withdraw ? 'ready to withdraw' : 'unstaking'}
              </span>
            )}
            {lockupStaked > 0n && (
              <span className="num">{formatNearBalance(lockupStaked)} staked</span>
            )}
            {lockupStaked === 0n && lockupUnstaked === 0n && (
              <span className="num">{formatNearBalance(lockup.accountBalance)} in lockup</span>
            )}
            {lockup.transferableBalance > 0n && lockup.transfersEnabled && (
              <span className="num dim">
                {formatNearBalance(lockup.transferableBalance)} transferable
              </span>
            )}
          </button>
        )}
        {positions.map((p) => {
          const isSelected = sameSelection(selected, { kind: 'pool', poolId: p.id });
          return (
            <button
              key={p.id}
              className={`vrow${isSelected ? ' active' : ''}`}
              disabled={busy}
              aria-pressed={isSelected}
              onClick={() => onSelect({ kind: 'pool', poolId: p.id })}
            >
              <span className="grow">{p.id}</span>
              {p.unstaked_balance > 0n && (
                <span className="num dim">
                  {formatNearBalance(p.unstaked_balance)}{' '}
                  {p.can_withdraw ? 'ready to withdraw' : 'unstaking'}
                </span>
              )}
              {p.staked_balance > 0n && (
                <span className="num">{formatNearBalance(p.staked_balance)}</span>
              )}
            </button>
          );
        })}
        {activeLiquidPools.map((pool) => {
          const tokenBalance = withoutStakingDust(BigInt(liquidBalances[pool.id] ?? '0'));
          const account = liquidAccounts[pool.id];
          const nearBalance = withoutStakingDust(BigInt(account?.staked_balance ?? '0'));
          const unstakedBalance = withoutStakingDust(
            BigInt(account?.unstaked_balance ?? '0')
          );
          const isSelected = sameSelection(selected, { kind: 'pool', poolId: pool.id });
          return (
            <button
              key={pool.id}
              className={`vrow${isSelected ? ' active' : ''}`}
              disabled={busy}
              aria-pressed={isSelected}
              onClick={() => onSelect({ kind: 'pool', poolId: pool.id })}
            >
              <span className="grow">{pool.id}</span>
              {unstakedBalance > 0n && (
                <span className="num dim">
                  {formatNearBalance(unstakedBalance)}{' '}
                  {account?.can_withdraw ? 'ready to withdraw' : 'unstaking'}
                </span>
              )}
              {tokenBalance > 0n && (
                <span className="num">
                  {formatTokenBalance(tokenBalance, pool.token)}
                  {nearBalance > 0n && ` (${formatNearBalance(nearBalance)})`}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
