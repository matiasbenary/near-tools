import { NetworkConfig } from '@/config';
import { useNetwork } from '@/components/app-providers';
import { formatNear } from '@/lib/near';
import { PoolAccount, Position } from '@/lib/staking';

/** A liquid pool is shown by its token balance, with the NEAR it is worth alongside. */
type Row = Position & { token?: { symbol: string; balance: bigint } };

const sum = (rows: Row[], key: 'staked_balance' | 'unstaked_balance') =>
  rows.reduce((total, row) => total + row[key], 0n);

export function MyPools({
  positions,
  selected,
  busy,
  liquidBalances,
  liquidAccounts,
  onSelect,
}: {
  positions: Position[];
  selected: string;
  busy: boolean;
  liquidBalances: Record<string, string>;
  liquidAccounts: Record<string, PoolAccount | undefined>;
  onSelect: (id: string) => void;
}) {
  const { network } = useNetwork();
  const liquidRows: Row[] = NetworkConfig[network].liquidPools
    .map((pool) => {
      const account = liquidAccounts[pool.id];
      return {
        id: pool.id,
        staked_balance: BigInt(account?.staked_balance ?? '0'),
        unstaked_balance: BigInt(account?.unstaked_balance ?? '0'),
        can_withdraw: account?.can_withdraw ?? false,
        token: { symbol: pool.token, balance: BigInt(liquidBalances[pool.id] ?? '0') },
      };
    })
    .filter((row) => row.token.balance > 0n || row.unstaked_balance > 0n);
  const rows: Row[] = [...positions, ...liquidRows];

  // ponytail: this used to render nothing at all — a new account saw no next step
  if (rows.length === 0)
    return (
      <section className="card empty-state">
        <h2>You have no stake yet</h2>
        <p>
          Pick a validator below, enter an amount, and review the transaction before it
          reaches your wallet. Rewards start accruing from the next epoch (~12 h).
        </p>
      </section>
    );

  const totalUnstaked = sum(rows, 'unstaked_balance');
  return (
    <section className="card">
      <div className="card-head">
        <h2>My Staking</h2>
        <span className="meta">
          {formatNear(sum(rows, 'staked_balance'))} staked
          {totalUnstaked > 0n && ` · ${formatNear(totalUnstaked)} unstaking`}
        </span>
      </div>
      <div className="vlist">
        {rows.map((row) => (
          <button
            key={row.id}
            className={`vrow${row.id === selected ? ' active' : ''}`}
            disabled={busy}
            onClick={() => onSelect(row.id)}
          >
            <span className="grow">{row.id}</span>
            {row.unstaked_balance > 0n && (
              <span className="num dim">
                {formatNear(row.unstaked_balance)}{' '}
                {row.can_withdraw ? 'ready to withdraw' : 'unstaking'}
              </span>
            )}
            {row.token ? (
              row.token.balance > 0n && (
                <span className="num">
                  {formatNear(row.token.balance, row.token.symbol)}
                  {row.staked_balance > 0n && ` (${formatNear(row.staked_balance)})`}
                </span>
              )
            ) : (
              row.staked_balance > 0n && (
                <span className="num">{formatNear(row.staked_balance)}</span>
              )
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
