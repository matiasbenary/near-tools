'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { Check, Copy, Trash2, TriangleAlert, X } from 'lucide-react';
import { HeldToken, Linkdrop } from '@/hooks/use-holdings';
import { fromUnits } from '@/lib/actions/contracts';
import { useNetwork } from '@/components/app-providers';
import { claimUrl } from '@/lib/actions/linkdrop-keys';

// ponytail: native <dialog> — modal, focus trap and Esc come free
function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog className="confirm-dialog holding-dialog" ref={ref} onClose={onClose}>
      <header className="holding-dialog-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="holding-dialog-sub">{subtitle}</p>}
        </div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => ref.current?.close()}>
          <X aria-hidden />
        </button>
      </header>
      {children}
    </dialog>
  );
}

/** Replaces window.confirm for destructive actions. */
export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="hint">{text}</p>
      <div className="confirm-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-danger" onClick={onConfirm}>
          <Trash2 aria-hidden />
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** A token selected for an attempted storage_unregister transaction. */
export type Removable = { token: HeldToken };

/** Confirms a storage removal; any balance still held is spelled out because it gets burned. */
export function RemoveTokensDialog({
  tokens,
  onConfirm,
  onClose,
}: {
  tokens: Removable[];
  onConfirm: () => void;
  onClose: () => void;
}) {
  const burning = tokens.filter((t) => t.token.balance > 0n);
  return (
    <Modal
      title={tokens.length === 1 ? `Remove ${tokens[0].token.symbol}` : `Remove ${tokens.length} tokens`}
      onClose={onClose}
    >
      <ul className="remove-token-list">
        {tokens.map(({ token }) => (
          <li key={token.contractId}>
            <span className="remove-token-name">
              {token.symbol}
              {token.symbol !== token.contractId && <small>{token.contractId}</small>}
            </span>
            <span className={token.balance > 0n ? 'remove-token-burn' : undefined}>
              {token.balance > 0n ? `Burns ${fromUnits(token.balance, token.decimals)}` : 'Empty'}
            </span>
          </li>
        ))}
      </ul>
      {burning.length > 0 && (
        <p className="hint error" role="alert">
          <TriangleAlert aria-hidden />{' '}
          {burning.length === 1 ? 'One token still holds' : `${burning.length} tokens still hold`} a balance. Removing
          burns it for good — it cannot be recovered.
        </p>
      )}
      <div className="confirm-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-danger" onClick={onConfirm}>
          <Trash2 aria-hidden />
          {burning.length > 0 ? 'Burn and remove' : 'Remove'}
        </button>
      </div>
    </Modal>
  );
}

export function DropDialog({
  drop,
  name,
  busy,
  onDelete,
  onClose,
}: {
  drop: Linkdrop;
  name: string;
  busy: boolean;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(-1);
  const { network } = useNetwork();
  const keys = drop.keys;
  const open = keys.filter((key) => !key.claimed).length;

  const copy = (link: string, index: number) =>
    navigator.clipboard.writeText(link).then(() => {
      setCopied(index);
      setTimeout(() => setCopied(-1), 2000);
    });

  return (
    <Modal title={name} subtitle={`Drop ${drop.drop_id} · ${open} of ${keys.length} unclaimed`} onClose={onClose}>
      {keys.length === 0 ? (
        <p className="hint">This browser holds no links for this drop.</p>
      ) : (
        <ol className="drop-links">
          {keys.map((key, index) => {
            const link = claimUrl(key.private, network);
            return (
              <li key={key.public} className={key.claimed ? 'claimed' : undefined}>
                <span className="drop-link-index">#{index + 1}</span>
                <span className={key.claimed ? 'status-pill' : 'status-pill open'}>
                  {key.claimed ? 'Claimed' : 'Unclaimed'}
                </span>
                <span className="drop-link" title={key.claimed ? undefined : link}>
                  {link.replace(/^https?:\/\//, '')}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={key.claimed}
                  onClick={() => copy(link, index)}
                >
                  {copied === index ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied === index ? 'Copied' : 'Copy'}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <div className="confirm-actions">
        <button type="button" className="btn btn-ghost btn-danger-ghost" disabled={busy} onClick={onDelete}>
          <Trash2 aria-hidden />
          {busy ? 'Deleting…' : drop.exists ? 'Delete & refund' : 'Forget drop'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
