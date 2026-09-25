import { ReactNode } from 'react';

export type ReviewRow = { label: string; value: ReactNode };

export type ReviewSheetProps = {
  /** What this does, in plain words. Not a field dump. */
  summary: string;
  network: string;
  signer: string;
  contract: string;
  method: string;
  rows?: ReviewRow[];
  image?: { src: string; alt: string };
  /** What leaves the wallet, or "Nothing — gas only". */
  send?: string;
  /** What arrives, when it is not the same asset (stNEAR, an NFT, claim links). */
  receive?: string;
  /** Storage deposit or network fee. */
  fee?: string;
  total?: string;
  unlock?: string;
  notices?: string[];
};

/**
 * The one sheet every action passes through before a signature — staking included.
 * The reference implementation on docs.near.org shows a cost and nothing else;
 * the wizard used to show everything except the cost. This shows both.
 */
export function ReviewSheet({
  summary,
  network,
  signer,
  contract,
  method,
  rows = [],
  image,
  send,
  receive,
  fee,
  total,
  unlock,
  notices = [],
}: ReviewSheetProps) {
  return (
    <div className="review-sheet">
      <p className="review-summary">{summary}</p>

      {image && (
        <div className="review-image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.src} alt={image.alt} />
        </div>
      )}

      <dl className="review-list">
        <div>
          <dt>Network</dt>
          <dd>{network}</dd>
        </div>
        <div>
          <dt>Signer</dt>
          <dd>{signer}</dd>
        </div>
        <div>
          <dt>Contract</dt>
          <dd>{contract}</dd>
        </div>
        <div>
          <dt>Method</dt>
          <dd>{method}</dd>
        </div>
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>

      {(send || receive || fee || total || unlock) && (
        <dl className="review-list review-cost">
          {send && (
            <div>
              <dt>You send</dt>
              <dd>{send}</dd>
            </div>
          )}
          {receive && (
            <div>
              <dt>You receive</dt>
              <dd>{receive}</dd>
            </div>
          )}
          {fee && (
            <div>
              <dt>Network fee / storage</dt>
              <dd>{fee}</dd>
            </div>
          )}
          {total && (
            <div className="review-total">
              <dt>Total cost</dt>
              <dd>{total}</dd>
            </div>
          )}
          {unlock && (
            <div>
              <dt>Available</dt>
              <dd>{unlock}</dd>
            </div>
          )}
        </dl>
      )}

      {notices.map((notice) => (
        <p key={notice} className="wizard-notice">
          {notice}
        </p>
      ))}
    </div>
  );
}
