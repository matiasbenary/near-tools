'use client';

import { useState } from 'react';
import { parseNearAmount, yoctoToNear } from 'near-api-js';
import { LockupAction, useLockupAction } from '@/hooks/use-lockup';
import type { LockupPosition } from '@/lib/lockup';
import { formatNearBalance } from '@/lib/staking';
import { describeError } from '@/lib/errors';
import { txHashOf } from '@/lib/near';
import { useNetwork } from './app-providers';
import { ReviewSheet } from './review-sheet';
import { ActivityEntry, ResultSheet, useActivity } from './result-sheet';
import { AmountInput } from './amount-input';

type Mode = 'unstake' | 'withdraw' | 'transfer';

export function LockupCard({ position, busy }: { position: LockupPosition; busy: boolean }) {
  const [mode, setMode] = useState<Mode>('unstake');
  const [amount, setAmount] = useState('');
  const [pending, setPending] = useState<{ action: LockupAction; message: string } | null>(null);
  const [result, setResult] = useState<ActivityEntry | null>(null);
  const { network } = useNetwork();
  const { record } = useActivity();
  const action = useLockupAction(position);
  const isBusy = busy || action.isPending;
  const staked = BigInt(position.poolAccount?.staked_balance ?? '0');
  const unstaked = BigInt(position.poolAccount?.unstaked_balance ?? '0');
  const canWithdraw = unstaked > 0n && !!position.poolAccount?.can_withdraw;
  const maxAmount = yoctoToNear(staked).replace(/,/g, '');
  let parsedAmount: string | null = null;
  try {
    if (amount) parsedAmount = parseNearAmount(amount as `${number}`);
  } catch {
    // Invalid input stays disabled until corrected.
  }
  const amountYocto = parsedAmount ? BigInt(parsedAmount) : 0n;
  const overMax = amountYocto > staked;

  const act = (nextAction: LockupAction, message: string) => {
    action.reset();
    setResult(null);
    setPending({ action: nextAction, message: message.replace(/^✓ /, '') });
  };

  const confirm = async () => {
    if (!pending) return;
    try {
      const outcome = await action.mutateAsync(pending.action);
      setResult(record({ network, summary: pending.message, txHash: txHashOf(outcome),
        next: pending.action.type === 'unstake'
          ? 'Withdraw into the lockup after four epochs, then transfer available funds to your wallet.'
          : pending.action.type === 'withdraw'
            ? 'Use Transfer to move available lockup funds to your wallet.'
            : undefined,
      }));
      setAmount('');
      setPending(null);
    } catch {
      // Keep the reviewed action available for retry.
    }
  };

  if (pending) {
    const reviewed = pending.action;
    const methods = {
      unstake: reviewed.type === 'unstake' && reviewed.amount ? 'unstake' : 'unstake_all',
      withdraw: 'withdraw_all_from_staking_pool',
      transfer: 'transfer',
      checkTransfers: 'check_transfers_vote',
    };
    const summary = reviewed.type === 'unstake'
      ? `Unstake ${reviewed.amount ? formatNearBalance(BigInt(reviewed.amount)) : 'everything'} from the lockup`
      : reviewed.type === 'withdraw'
        ? `Withdraw ${formatNearBalance(unstaked)} into the lockup`
        : reviewed.type === 'transfer'
          ? `Transfer ${formatNearBalance(BigInt(reviewed.amount))} to ${position.ownerId}`
          : 'Check whether lockup transfers can be enabled';
    const failure = action.error ? describeError(action.error) : null;
    return (
      <div className="card">
        <h2>Review</h2>
        <ReviewSheet
          summary={summary}
          network={network}
          signer={position.ownerId}
          contract={position.id}
          method={methods[reviewed.type]}
          send="Nothing from your wallet — gas only"
          receive={reviewed.type === 'transfer' ? `${formatNearBalance(BigInt(reviewed.amount))} in your wallet`
            : reviewed.type === 'withdraw' ? `${formatNearBalance(unstaked)} in the lockup account` : undefined}
          unlock={reviewed.type === 'unstake' ? 'Four epochs before withdrawal into the lockup' : undefined}
          notices={['Withdrawals return to the lockup account. Transfers move only available funds to its owner; locked funds and storage remain in the lockup.']}
        />
        {failure && <p className="hint error" role="alert">{failure.message}<br /><small>{failure.detail}</small></p>}
        <div className="wizard-actions">
          <button className="btn btn-ghost" disabled={isBusy} onClick={() => setPending(null)}>Back</button>
          <button className="btn" disabled={isBusy} onClick={() => void confirm()}>
            {isBusy ? 'Confirm in wallet…' : failure?.retryable ? 'Try again' : 'Confirm'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Lockup · {position.poolId ?? 'No validator selected'}</h2>
      <p className="meta lockup-id" title={position.id}>{position.id}</p>
      <div className="pool-balances">
        <div className="kv"><span>Staked</span><span>{formatNearBalance(staked)}</span></div>
        <div className="kv"><span>Unstaked at validator</span><span>{formatNearBalance(unstaked)}</span></div>
        <div className="kv"><span>In lockup account</span><span>{formatNearBalance(position.accountBalance)}</span></div>
        <div className="kv"><span>Still locked</span><span>{formatNearBalance(position.lockedBalance)}</span></div>
        <div className="kv"><span>Available to transfer</span><span>{formatNearBalance(position.transfersEnabled ? position.transferableBalance : 0n)}</span></div>
      </div>
      <div className="modes">
        {(['unstake', 'withdraw', 'transfer'] as const).map((nextMode) => (
          <button
            key={nextMode}
            className={mode === nextMode ? 'active' : ''}
            disabled={isBusy}
            onClick={() => {
              setMode(nextMode);
              setAmount('');
              setResult(null);
              action.reset();
            }}
          >
            {nextMode[0].toUpperCase() + nextMode.slice(1)}
          </button>
        ))}
      </div>
      {mode === 'unstake' ? (
        <>
          <AmountInput
            amount={amount}
            setAmount={setAmount}
            maxAmount={maxAmount}
            unit="NEAR"
            busy={isBusy}
            disabled={staked === 0n}
            overMax={overMax}
            ariaLabel="Amount to unstake from lockup"
          />
          <p className={`avail${overMax ? ' error' : ''}`}>
            {overMax ? 'Exceeds staked balance' : `Available ${formatNearBalance(staked)}`}
          </p>
          <button
            className="btn btn-block"
            disabled={isBusy || amountYocto <= 0n || overMax || staked === 0n}
            onClick={() =>
              void act(
                amountYocto === staked
                  ? { type: 'unstake' }
                  : { type: 'unstake', amount: parsedAmount! },
                `✓ Unstaked ${amount} Ⓝ from the lockup`
              )
            }
          >
            {isBusy ? 'Confirm in wallet…' : 'Review unstake'}
          </button>
          <p className="hint">Unstaked NEAR becomes withdrawable after four epochs.</p>
        </>
      ) : mode === 'withdraw' ? (
        <>
          <p className="avail">
            {unstaked === 0n
              ? 'Nothing to withdraw from the validator.'
              : canWithdraw
                ? `${formatNearBalance(unstaked)} ready to withdraw into the lockup account.`
                : `${formatNearBalance(unstaked)} is waiting for the four epoch unstaking period.`}
          </p>
          <button
            className="btn btn-block"
            disabled={isBusy || !canWithdraw}
            onClick={() => void act({ type: 'withdraw' }, `✓ Withdrew ${formatNearBalance(unstaked)} into the lockup`)}
          >
            {isBusy ? 'Confirm in wallet…' : 'Review withdrawal to lockup'}
          </button>
          <p className="hint">To move available funds to your wallet, use Transfer after withdrawal.</p>
        </>
      ) : (
        <>
          <p className="avail">
            {position.transfersEnabled
              ? `${formatNearBalance(position.transferableBalance)} can move to ${position.ownerId}.`
              : 'Transfers are disabled in the lockup. Check whether the transfer vote has enabled them.'}
          </p>
          <button
            className="btn btn-block"
            disabled={isBusy || (position.transfersEnabled && position.transferableBalance === 0n)}
            onClick={() =>
              position.transfersEnabled
                ? void act(
                    { type: 'transfer', amount: position.transferableBalance.toString() },
                    `✓ Transferred ${formatNearBalance(position.transferableBalance)} to ${position.ownerId}`
                  )
                : void act({ type: 'checkTransfers' }, '✓ Transfer availability checked')
            }
          >
            {isBusy
              ? 'Confirm in wallet…'
              : position.transfersEnabled
                ? 'Review transfer all'
                : 'Review transfer availability check'}
          </button>
          <p className="hint">Locked funds and the contract storage balance remain in the lockup.</p>
        </>
      )}
      {result && <ResultSheet entry={result} />}
    </div>
  );
}
