'use client';

import { ReactNode, useCallback, useEffect, useState } from 'react';
import { NetworkId, txUrl } from '@/config';
import { useNetwork } from '@/components/app-providers';

export type ActivityEntry = {
  id: string;
  network: NetworkId;
  /** "Staked 5 Ⓝ to aurora.poolv1.near" */
  summary: string;
  txHash?: string;
  at: number;
  /** What happens next, when the transaction is not the end of the story. */
  next?: string;
};

const storageKey = 'near-stake-activity';
const keep = 10;

/**
 * Receipts outlive the card that produced them. The old success message lived in
 * PoolCard state and was wiped by any mode-tab change, so a user had no record
 * that a transaction had happened at all.
 */
export function useActivity() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) setEntries(JSON.parse(stored) as ActivityEntry[]);
    } catch {
      // ponytail: private mode / blocked storage — an empty history is fine
    }
  }, []);

  const record = useCallback((entry: Omit<ActivityEntry, 'id' | 'at'>) => {
    const full: ActivityEntry = { ...entry, id: crypto.randomUUID(), at: Date.now() };
    setEntries((current) => {
      const next = [full, ...current].slice(0, keep);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // history is a convenience, never a correctness requirement
      }
      return next;
    });
    return full;
  }, []);

  return { entries, record };
}

export function TxLink({ network, hash, children }: { network: NetworkId; hash: string; children: ReactNode }) {
  return (
    <a href={txUrl(network, hash)} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function ResultSheet({ entry }: { entry: ActivityEntry }) {
  return (
    <div className="result-sheet" role="status">
      <p className="result-summary">✓ {entry.summary}</p>
      {entry.next && <p className="result-next">{entry.next}</p>}
      <p className="result-meta">
        <time dateTime={new Date(entry.at).toISOString()}>
          {new Date(entry.at).toLocaleString()}
        </time>
        {entry.txHash && (
          <>
            {' · '}
            <TxLink network={entry.network} hash={entry.txHash}>View transaction</TxLink>
          </>
        )}
      </p>
    </div>
  );
}

export function ActivityList() {
  const { entries } = useActivity();
  const { network } = useNetwork();
  const visible = entries.filter((entry) => entry.network === network);
  if (visible.length === 0) return null;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Recent activity</h2>
      </div>
      <ul className="activity-list">
        {visible.map((entry) => (
          <li key={entry.id}>
            <span className="grow">{entry.summary}</span>
            <span className="num dim">
              {new Date(entry.at).toLocaleDateString()}
              {entry.txHash && (
                <>
                  {' · '}
                  <TxLink network={entry.network} hash={entry.txHash}>tx</TxLink>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
