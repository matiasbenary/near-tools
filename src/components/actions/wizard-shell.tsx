'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNearWallet } from 'near-connect-hooks';
import { useNetwork } from '@/components/app-providers';
import { TestnetFaucet } from '@/components/testnet-faucet';
import { ReviewSheet, ReviewSheetProps } from '@/components/review-sheet';
import { ActivityEntry, ResultSheet, useActivity } from '@/components/result-sheet';
import { registerNetworkGuard } from '@/lib/network-guards';
import { describeError } from '@/lib/errors';
import { refreshAfterTx } from '@/lib/near';
import { ActionKind } from '@/lib/actions/contracts';

/**
 * T-06 gate: the testnet contracts are proven, the mainnet ones are verified as
 * existing but not yet as callable by us. Flip per action after one real mainnet
 * transaction confirms the interface. See ux-action-plan.md.
 */
const mainnetVerified: Record<ActionKind, boolean> = {
  ft: false,
  nft: false,
  linkdrop: false,
};

export type Review = Omit<ReviewSheetProps, 'network' | 'signer'>;
export type Receipt = Omit<ActivityEntry, 'id' | 'at' | 'network'>;

/**
 * Configure → Review → sign, shared by every action. The action owns its form
 * and knows how to quote and send itself; this owns the steps in between.
 */
export function WizardShell({
  kind,
  title,
  description,
  dirty,
  children,
  review,
  submit,
  afterResult,
}: {
  kind: ActionKind;
  title: string;
  description: string;
  /** A part-filled form, so a network switch warns before clearing it. */
  dirty: boolean;
  /** The form fields. */
  children: ReactNode;
  /** Validate and quote. Null keeps the user on the form (field errors are shown there). */
  review: () => Promise<Review | null>;
  /** Send the transaction(s) and describe what happened. */
  submit: () => Promise<Receipt>;
  /** Extra content under the receipt, e.g. the claim links of a new drop. */
  afterResult?: ReactNode;
}) {
  const { network } = useNetwork();
  const { signedAccountId } = useNearWallet();
  const { record } = useActivity();
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState<Review | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ActivityEntry | null>(null);
  const canSubmit = network === 'testnet' || mainnetVerified[kind];

  // Warn before a network switch throws away a part-filled form (the provider remounts on switch).
  useEffect(
    () => registerNetworkGuard(() => (dirty ? 'The action you are configuring will be cleared.' : null)),
    [dirty]
  );

  const run = async (step: () => Promise<void>) => {
    setWorking(true);
    setError('');
    try {
      await step();
    } catch (failure) {
      setError(describeError(failure).message);
    } finally {
      setWorking(false);
    }
  };

  const toReview = () => run(async () => setReviewing(await review()));

  const confirm = () =>
    run(async () => {
      setResult(record({ network, ...(await submit()) }));
      setReviewing(null);
      // the new FT/NFT/drop shows up without a reload
      refreshAfterTx(() => {
        for (const key of [['holdings'], ['owned-nfts'], ['drops']])
          queryClient.invalidateQueries({ queryKey: key });
      });
    });

  return (
    <div className="actions-layout">
      {network === 'testnet' && <TestnetFaucet accountId={signedAccountId} />}
      <section className="wizard-shell" aria-labelledby="actions-title">
        <header className="wizard-header">
          <div>
            <p className="wizard-kicker">{network} actions</p>
            <h1 id="actions-title">Build a transaction</h1>
            <p>Configure the action, inspect every value, then approve it in your wallet.</p>
          </div>
          <div className="wizard-account-wrap">
            <span className="wizard-account">{signedAccountId}</span>
          </div>
        </header>

        <ol className="wizard-progress" aria-label="Action progress">
          <li className="active">
            <span aria-hidden="true">1</span>Configure
          </li>
          <li className={reviewing ? 'active' : ''}>
            <span aria-hidden="true">2</span>Review
          </li>
        </ol>

        <div className="wizard-step">
          <div className="wizard-step-heading">
            <h2>{reviewing ? `Review ${title}` : title}</h2>
          </div>

          {reviewing ? (
            <ReviewSheet network={network} signer={signedAccountId} {...reviewing} />
          ) : (
            <>
              <p className="wizard-tab-description">{description}</p>
              {!canSubmit && (
                <p className="wizard-notice">
                  This action is verified on testnet only. Switch to testnet to sign it.
                </p>
              )}
              <div className="wizard-fields">{children}</div>
            </>
          )}

          {error && <p className="hint error" role="alert">{error}</p>}
          <div className="wizard-actions">
            {reviewing ? (
              <>
                <button className="btn btn-ghost" disabled={working} onClick={() => setReviewing(null)}>
                  Back
                </button>
                <button className="btn" disabled={working || !canSubmit} onClick={confirm}>
                  {working ? 'Confirm in wallet…' : canSubmit ? 'Confirm and sign' : 'Testnet only for now'}
                </button>
              </>
            ) : (
              <button className="btn" disabled={working} onClick={toReview}>
                {working ? 'Checking…' : 'Review action'}
              </button>
            )}
          </div>
        </div>

        {result && (
          <div className="wizard-step">
            <ResultSheet entry={result} />
            {afterResult}
          </div>
        )}
      </section>
    </div>
  );
}
