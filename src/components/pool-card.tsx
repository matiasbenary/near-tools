'use client';
import { useState } from 'react';
import { useNearWallet } from 'near-connect-hooks';
import { parseNearAmount, yoctoToNear } from 'near-api-js';
import { LiquidPool, NetworkConfig } from '@/config';
import { useNetwork } from '@/components/app-providers';
import { StakingAction, useStakingAction } from '@/hooks/use-staking';
import { ReviewSheet } from '@/components/review-sheet';
import { ActivityEntry, ResultSheet, useActivity } from '@/components/result-sheet';
import { describeError } from '@/lib/errors';
import { formatNear, toInputAmount, txHashOf } from '@/lib/near';
import { apyLabel, GAS_RESERVE, minFastUnstake, PoolAccount } from '@/lib/staking';

type Mode = 'stake' | 'unstake' | 'fast' | 'withdraw';

/** Everything the review sheet needs, built before anything reaches the wallet. */
type Pending = {
  action: StakingAction;
  summary: string;
  method: string;
  send?: string;
  receive?: string;
  unlock?: string;
  notices?: string[];
  /** Receipt text once it succeeds. */
  okSummary: string;
  next?: string;
};

const toYocto = (amount: string) => parseNearAmount(amount as `${number}`) ?? '0';

function AmountInput({
  amount,
  setAmount,
  maxAmount,
  unit,
  busy,
  ariaLabel,
  overMax = false,
  disabled = false,
}: {
  amount: string;
  setAmount: (amount: string) => void;
  maxAmount: string;
  unit: string;
  busy: boolean;
  ariaLabel: string;
  overMax?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`amount${overMax ? ' over' : ''}`}>
      <input
        type="number"
        min="0"
        placeholder="0.0"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        aria-label={ariaLabel}
      />
      <button className="max" disabled={busy || disabled} onClick={() => setAmount(maxAmount)}>
        MAX
      </button>
      <span className="unit">{unit}</span>
    </div>
  );
}

/** Pool name, APY breakdown and what this account holds in it. */
function PoolSummary({
  poolId,
  account,
  fee,
  baseApy,
  liquidPool,
  liquidBalance,
}: {
  poolId: string;
  account: PoolAccount | null;
  fee: number | undefined;
  baseApy: number | null;
  liquidPool: LiquidPool | undefined;
  liquidBalance: string | undefined;
}) {
  const staked = account ? formatNear(BigInt(account.staked_balance)) : '—';
  return (
    <>
      <h2>{poolId}</h2>
      <p className="meta">
        {liquidPool ? (
          `Estimated APY ${apyLabel(baseApy, fee)}`
        ) : baseApy !== null && fee !== undefined ? (
          <>
            APY {baseApy.toFixed(1)}% · fee {(fee * 100).toFixed(1)}% ·{' '}
            <span className="net">net {apyLabel(baseApy, fee)}</span>
          </>
        ) : (
          `APY ${apyLabel(baseApy, fee)}`
        )}
      </p>
      <div className="pool-balances">
        <div className="kv">
          <span>Staked here</span>
          <span>
            {liquidPool && liquidBalance !== undefined
              ? `${formatNear(BigInt(liquidBalance), liquidPool.token)}${
                  account && BigInt(account.staked_balance) > 0n ? ` (${staked})` : ''
                }`
              : staked}
          </span>
        </div>
        <div className="kv">
          <span>Unstaked here</span>
          <span>{account ? formatNear(BigInt(account.unstaked_balance)) : '—'}</span>
        </div>
      </div>
    </>
  );
}

function PoolReview({
  poolId,
  pending,
  busy,
  error,
  onBack,
  onConfirm,
}: {
  poolId: string;
  pending: Pending;
  busy: boolean;
  error: unknown;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const { network } = useNetwork();
  const failure = error ? describeError(error) : null;
  return (
    <div className="card">
      <h2>Review</h2>
      <ReviewSheet
        summary={pending.summary}
        network={network}
        signer="your connected wallet"
        contract={poolId}
        method={pending.method}
        send={pending.send}
        receive={pending.receive}
        unlock={pending.unlock}
        notices={pending.notices}
      />
      {failure && (
        <p className="hint error" role="alert">
          {failure.message}
          <br />
          <small>{failure.detail}</small>
        </p>
      )}
      <div className="wizard-actions">
        <button className="btn btn-ghost" disabled={busy} onClick={onBack}>
          Back
        </button>
        <button className="btn" disabled={busy} onClick={onConfirm}>
          {busy ? 'Confirm in wallet…' : failure?.retryable ? 'Try again' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}

export function PoolCard({
  poolId,
  account,
  balance,
  fee,
  baseApy,
  liquidBalance,
  busy,
}: {
  poolId: string;
  account: PoolAccount | null;
  balance: string | null;
  fee: number | undefined;
  baseApy: number | null;
  liquidBalance: string | undefined;
  busy: boolean;
}) {
  const { network } = useNetwork();
  const { viewFunction } = useNearWallet();
  const [mode, setMode] = useState<Mode>('stake');
  const [amount, setAmount] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [result, setResult] = useState<ActivityEntry | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoting, setQuoting] = useState(false);
  const action = useStakingAction(poolId);
  const { record } = useActivity();
  const isBusy = busy || action.isPending;

  const walletYocto = balance ? BigInt(balance) : 0n;
  const stakedYocto = BigInt(account?.staked_balance ?? '0');
  const unstakedYocto = BigInt(account?.unstaked_balance ?? '0');
  const canWithdraw = !!account?.can_withdraw && unstakedYocto > 0n;
  const availYocto =
    mode === 'stake' ? (walletYocto > GAS_RESERVE ? walletYocto - GAS_RESERVE : 0n) : stakedYocto;
  const maxAmount = toInputAmount(availYocto);
  const overMax = amount !== '' && Number(amount) > Number(maxAmount);
  const validAmount = amount !== '' && Number(amount) > 0;

  const liquidPool = NetworkConfig[network].liquidPools.find((pool) => pool.id === poolId);
  const fastExit = liquidPool?.fastExit;
  const modes: { id: Mode; label: string }[] = [
    { id: 'stake', label: 'Stake' },
    { id: 'unstake', label: 'Unstake' },
    ...(fastExit ? [{ id: 'fast' as const, label: 'Fast Unstake' }] : []),
    { id: 'withdraw', label: 'Withdraw' },
  ];

  // Typing the exact maximum used to silently become unstake_all while the success
  // message still named the typed amount. Now it is a deliberate, labelled choice.
  const isFullExit = mode === 'unstake' && validAmount && !overMax && Number(amount) === Number(maxAmount);

  const switchMode = (next: Mode) => {
    setMode(next);
    setAmount('');
    action.reset();
    setResult(null);
    setPending(null);
    setQuoteError('');
  };

  const confirm = async () => {
    if (!pending) return;
    action.reset();
    try {
      const outcome = await action.mutateAsync(pending.action);
      setResult(
        record({ network, summary: pending.okSummary, txHash: txHashOf(outcome), next: pending.next })
      );
      setAmount('');
      setPending(null);
    } catch {
      // The mutation exposes the error; PoolReview renders it.
    }
  };

  const reviewStake = () =>
    setPending({
      action: { type: 'stake', amount: toYocto(amount) },
      summary: `Stake ${amount} Ⓝ with ${poolId}`,
      method: 'deposit_and_stake',
      send: `${amount} Ⓝ`,
      receive: liquidPool ? `${liquidPool.token} representing your stake` : `A staking position in ${poolId}`,
      notices: liquidPool
        ? [`${liquidPool.token} is a token representing your stake. It is tradable and has no unlock period.`]
        : [],
      okSummary: `Staked ${amount} Ⓝ with ${poolId}`,
      next: 'Rewards accrue every epoch (~12 h) and compound automatically.',
    });

  const reviewUnstake = () => {
    const what = isFullExit ? 'everything' : `${amount} Ⓝ`;
    setPending({
      action: isFullExit ? { type: 'unstake' } : { type: 'unstake', amount: toYocto(amount) },
      summary: `Unstake ${what} from ${poolId}`,
      method: isFullExit ? 'unstake_all' : 'unstake',
      send: 'Nothing — gas only',
      receive: `${amount} Ⓝ, after the unlock period`,
      unlock: 'About 2 days (4 epochs) from now',
      notices: isFullExit ? ['This closes your position in this pool.'] : [],
      okSummary: `Unstaked ${what} from ${poolId}`,
      next: 'Withdraw the funds once the unlock period ends.',
    });
  };

  const reviewWithdraw = () => {
    const unstaked = formatNear(unstakedYocto);
    setPending({
      action: { type: 'withdraw' },
      summary: `Withdraw ${unstaked} from ${poolId}`,
      method: 'withdraw_all',
      send: 'Nothing — gas only',
      receive: unstaked,
      okSummary: `Withdrew ${unstaked} from ${poolId}`,
    });
  };

  /** Fast Unstake quotes live. Without a quote we refuse rather than sign blind. */
  const reviewFastUnstake = async () => {
    const burn = parseNearAmount(amount as `${number}`);
    if (!burn || !liquidPool) return;
    setQuoting(true);
    setQuoteError('');
    try {
      const price = BigInt(
        (await viewFunction({ contractId: poolId, method: 'get_st_near_price', args: {} })) as string
      );
      const expected = (BigInt(burn) * price) / 10n ** 24n;
      const minimum = minFastUnstake(expected);
      setPending({
        action: { type: 'fastUnstake', amount: burn, minExpected: minimum.toString() },
        summary: `Fast-unstake ${amount} ${liquidPool.token} for NEAR, immediately`,
        method: 'liquid_unstake',
        send: `${amount} ${liquidPool.token}`,
        receive: `≈ ${yoctoToNear(expected, 4)} Ⓝ`,
        notices: [
          `You receive at least ${yoctoToNear(minimum, 4)} Ⓝ. The transaction fails rather than paying you less.`,
          'Fast exit uses Meta Pool liquidity, so the live fee comes out of the amount above.',
        ],
        okSummary: `Fast-unstaked ${amount} ${liquidPool.token}`,
      });
    } catch (error) {
      setQuoteError(`${describeError(error).message} A quote is required before a fast unstake.`);
    } finally {
      setQuoting(false);
    }
  };

  if (pending)
    return (
      <PoolReview
        poolId={poolId}
        pending={pending}
        busy={isBusy}
        error={action.error}
        onBack={() => {
          setPending(null);
          setQuoteError('');
        }}
        onConfirm={confirm}
      />
    );

  const hints: Record<Mode, string> = {
    stake: liquidPool
      ? `Liquid pool: you receive ${liquidPool.token}, a tradable token representing your stake — no unlock period to exit.`
      : 'Rewards accrue every epoch (~12 h) and compound automatically.',
    unstake: 'Unstaked funds unlock after 4 epochs (~2 days), then withdraw them.',
    fast: 'Swap your liquid-staking token for NEAR immediately, at the live rate.',
    withdraw: 'Withdrawing moves unlocked funds back to your wallet.',
  };

  return (
    <div className="card">
      <PoolSummary
        poolId={poolId}
        account={account}
        fee={fee}
        baseApy={baseApy}
        liquidPool={liquidPool}
        liquidBalance={liquidBalance}
      />
      <div className="modes">
        {modes.map((m) => (
          <button
            key={m.id}
            className={mode === m.id ? 'active' : ''}
            disabled={isBusy}
            onClick={() => switchMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'fast' && fastExit?.type === 'metapool' && liquidPool && (
        <>
          <AmountInput
            amount={amount}
            setAmount={setAmount}
            maxAmount={liquidBalance ? toInputAmount(BigInt(liquidBalance)) : ''}
            unit={liquidPool.token}
            busy={isBusy}
            disabled={!liquidBalance}
            ariaLabel="stNEAR amount to fast unstake"
          />
          <p className="avail">
            {liquidBalance
              ? `Available ${yoctoToNear(BigInt(liquidBalance), 2)} ${liquidPool.token}`
              : `Loading ${liquidPool.token} balance…`}
          </p>
          <button
            className="btn btn-block"
            disabled={isBusy || quoting || !validAmount || !liquidBalance}
            onClick={reviewFastUnstake}
          >
            {quoting ? 'Getting a quote…' : 'Review fast unstake'}
          </button>
        </>
      )}

      {mode === 'fast' && fastExit?.type === 'external' && (
        <>
          <p className="avail">
            Receive NEAR immediately by swapping your liquid-staking token. The provider will
            show the live quote, fee, and slippage before you approve.
          </p>
          <a className="btn btn-block" href={fastExit.url} target="_blank" rel="noreferrer">
            Fast Unstake on {fastExit.label} ↗
          </a>
          <p className="hint">Opens {fastExit.label}, a third-party app.</p>
        </>
      )}

      {(mode === 'stake' || mode === 'unstake') && (
        <>
          <AmountInput
            amount={amount}
            setAmount={setAmount}
            maxAmount={maxAmount}
            unit="NEAR"
            busy={isBusy}
            overMax={overMax}
            ariaLabel="Amount"
          />
          <p className={`avail${overMax ? ' error' : ''}`}>
            {overMax ? 'Exceeds available' : 'Available'} {yoctoToNear(availYocto, 2)} Ⓝ
          </p>
          {mode === 'stake' && (
            <p className="avail">MAX leaves 0.1 Ⓝ in your wallet for transaction fees.</p>
          )}
          <button
            className="btn btn-block"
            disabled={isBusy || !validAmount || overMax}
            onClick={mode === 'stake' ? reviewStake : reviewUnstake}
          >
            {mode === 'stake' ? 'Review stake' : isFullExit ? 'Review unstake all' : 'Review unstake'}
          </button>
        </>
      )}

      {mode === 'withdraw' && (
        <>
          <p className="avail">
            {unstakedYocto === 0n
              ? 'Nothing to withdraw.'
              : canWithdraw
                ? `${yoctoToNear(unstakedYocto, 2)} Ⓝ ready to withdraw.`
                : `${yoctoToNear(unstakedYocto, 2)} Ⓝ unlocking — available about 2 days (4 epochs) after you unstaked.`}
          </p>
          <button className="btn btn-block" disabled={isBusy || !canWithdraw} onClick={reviewWithdraw}>
            Review withdrawal
          </button>
        </>
      )}

      {quoteError && (
        <p className="hint error" role="alert">
          {quoteError}
        </p>
      )}
      {result && <ResultSheet entry={result} />}
      <p className="hint">{hints[mode]}</p>
    </div>
  );
}
