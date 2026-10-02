'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNearWallet } from 'near-connect-hooks';
import { useNetwork } from '@/components/app-providers';
import { ReviewSheet, ReviewSheetProps } from '@/components/review-sheet';
import { ActivityEntry, ResultSheet, useActivity } from '@/components/result-sheet';
import { registerNetworkGuard } from '@/lib/network-guards';
import { describeError } from '@/lib/errors';
import { refreshAfterTx } from '@/lib/near';

export type Review = Omit<ReviewSheetProps, 'network' | 'signer'>;
export type Receipt = Omit<ActivityEntry, 'id' | 'at' | 'network'>;

/**
 * Configure → Review → sign, shared by every action. The action owns its form
 * and knows how to quote and send itself; this owns the steps in between.
 */
export function WizardShell({
  title,
  description,
  dirty,
  children,
  review,
  submit,
  afterResult,
}: {
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
      <section className="wizard-shell" aria-labelledby="actions-title">
        <header className="wizard-header">
          <div>
            <h1 id="actions-title">{title}</h1>
            <p>{description}</p>
          </div>
        </header>

        <div className="wizard-step">
          {reviewing ? (
            <ReviewSheet network={network} signer={signedAccountId} {...reviewing} />
          ) : (
            <div className="wizard-fields">{children}</div>
          )}

          {error && <p className="hint error" role="alert">{error}</p>}
          {error && afterResult}
          <div className="wizard-actions">
            {reviewing ? (
              <>
                <button className="btn btn-ghost" disabled={working} onClick={() => setReviewing(null)}>
                  Back
                </button>
                <button className="btn" disabled={working} onClick={confirm}>
                  {working ? 'Confirm in wallet…' : 'Confirm and sign'}
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
