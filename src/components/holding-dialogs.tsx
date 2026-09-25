'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { useNearWallet } from 'near-connect-hooks';
import { Check, Copy, Send, Trash2, X } from 'lucide-react';
import { useNetwork } from '@/components/app-providers';
import { Field, useForm } from '@/components/actions/form-fields';
import { HeldToken, KeypomDrop, OwnedNft } from '@/hooks/use-holdings';
import { ActionContracts, fromUnits, toUnits } from '@/lib/actions/contracts';
import { claimUrl } from '@/lib/actions/linkdrop-keys';
import { describeError } from '@/lib/errors';
import { FT_STORAGE_DEPOSIT, GAS, txHashOf } from '@/lib/near';

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

export type SendTarget = { kind: 'ft'; token: HeldToken } | { kind: 'nft'; token: OwnedNft };

export function SendDialog({ target, onClose, onSent }: { target: SendTarget; onClose: () => void; onSent: () => void }) {
  const { signedAccountId: owner, provider, viewFunction, signAndSendTransactions } = useNearWallet();
  const { network } = useNetwork();
  const form = useForm({ sendTo: '', sendAmount: '' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const ft = target.kind === 'ft' ? target.token : null;
  const nft = target.kind === 'nft' ? target.token : null;
  const name = ft?.symbol ?? (nft?.metadata?.title || nft?.token_id);

  const accountExists = (accountId: string) =>
    // Implicit accounts are valid before they exist on chain.
    /^[0-9a-f]{64}$/.test(accountId) ||
    provider.viewAccount({ accountId, blockQuery: { finality: 'final' } }).then(
      () => true,
      () => false
    );

  const send = async () => {
    const receiver = form.fields.sendTo.trim().toLowerCase();
    const found: { sendTo?: string; sendAmount?: string } = {};
    let amount = 0n;
    if (!receiver) found.sendTo = 'Required.';
    else if (receiver === owner) found.sendTo = 'That is your own account.';
    if (ft) {
      try {
        amount = toUnits(form.fields.sendAmount, ft.decimals);
      } catch {
        amount = 0n;
      }
      if (amount <= 0n) found.sendAmount = 'A positive amount.';
      else if (amount > ft.balance) found.sendAmount = `You hold ${fromUnits(ft.balance, ft.decimals)}.`;
    }
    if (!form.check(found)) return;

    setBusy(true);
    setNote(null);
    try {
      if (!(await accountExists(receiver))) {
        form.check({ sendTo: `${receiver} does not exist on ${network}.` });
        return;
      }
      const call = (methodName: string, args: object, deposit: bigint) => ({
        type: 'FunctionCall' as const,
        params: { methodName, args, gas: GAS.toString(), deposit: deposit.toString() },
      });
      const actions = [];
      let contractId: string;
      if (ft) {
        contractId = ft.contractId;
        const registered = await viewFunction({
          contractId,
          method: 'storage_balance_of',
          args: { account_id: receiver },
        }).catch(() => null);
        if (!registered)
          actions.push(call('storage_deposit', { account_id: receiver, registration_only: true }, FT_STORAGE_DEPOSIT));
        actions.push(call('ft_transfer', { receiver_id: receiver, amount: amount.toString() }, 1n));
      } else {
        contractId = ActionContracts[network].nft.contractId;
        actions.push(call('nft_transfer', { receiver_id: receiver, token_id: nft!.token_id }, 1n));
      }
      const [outcome] = await signAndSendTransactions({
        transactions: [{ receiverId: contractId, actions }],
      });
      setNote({ ok: true, text: `Sent to ${receiver}. Tx ${txHashOf(outcome) ?? ''}` });
      onSent();
    } catch (error) {
      setNote({ ok: false, text: describeError(error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Send ${name}`} onClose={onClose}>
      <div className="holding-dialog-form">
        <Field {...form.bind('sendTo')} label="Receiver account" placeholder="alice.near" required />
        {ft && (
          <Field
            {...form.bind('sendAmount')}
            label={`Amount (${ft.symbol})`}
            type="number"
            hint={`Balance: ${fromUnits(ft.balance, ft.decimals)}`}
            required
          />
        )}
      </div>
      {note && (
        <p className={note.ok ? 'hint' : 'hint error'} role="status">
          {note.text}
        </p>
      )}
      <div className="confirm-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {note?.ok ? 'Close' : 'Cancel'}
        </button>
        {!note?.ok && (
          <button type="button" className="btn" disabled={busy} onClick={send}>
            <Send aria-hidden />
            {busy ? 'Sending…' : 'Send'}
          </button>
        )}
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
  drop: KeypomDrop;
  name: string;
  busy: boolean;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(-1);
  const keys = drop.keys ?? [];
  const open = keys.filter((key) => !key.claimed).length;

  const copy = (link: string, index: number) =>
    navigator.clipboard.writeText(link).then(() => {
      setCopied(index);
      setTimeout(() => setCopied(-1), 2000);
    });

  return (
    <Modal
      title={name}
      subtitle={`Drop ${drop.drop_id} · ${open} of ${keys.length} unclaimed`}
      onClose={onClose}
    >
      {keys.length === 0 ? (
        <p className="hint">This browser holds no links for this drop.</p>
      ) : (
        <ol className="drop-links">
          {keys.map((key, index) => {
            const link = claimUrl(key.private);
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
          {busy ? 'Deleting…' : drop.locallyManaged ? 'Forget drop' : 'Delete & refund'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
