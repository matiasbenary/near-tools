'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNearWallet } from 'near-connect-hooks';
import { yoctoToNear } from 'near-api-js';
import { ArrowDownToLine, BadgeCheck, Link, Send, ShieldAlert, Trash2 } from 'lucide-react';
import { useNetwork } from '@/components/app-providers';
import { DropDialog, Removable, RemoveTokensDialog, SendDialog, SendTarget } from '@/components/holding-dialogs';
import {
  FtStorage,
  HeldToken,
  KeypomDrop,
  OwnedNft,
  useDrops,
  useFtStorage,
  useHoldings,
  useKeypomBalance,
  useOwnedNfts,
} from '@/hooks/use-holdings';
import { ActionContracts, ActionKind, fromUnits } from '@/lib/actions/contracts';
import { forgetDrop } from '@/lib/actions/linkdrop-keys';
import { describeError } from '@/lib/errors';
import { GAS, GAS_300, refreshAfterTx } from '@/lib/near';

const titles: Record<ActionKind, string> = {
  ft: 'Your tokens',
  nft: 'Your NFTs',
  linkdrop: 'Your drops',
};

const columns: Record<ActionKind, string[]> = {
  ft: ['Token', 'Contract', 'Balance', 'Action'],
  nft: ['NFT', 'Token ID', 'Owner', 'Action'],
  linkdrop: ['Drop', 'Drop ID', 'Links', 'Action'],
};

const empty: Record<ActionKind, string> = {
  ft: 'No fungible tokens on this account yet.',
  nft: 'No NFTs minted from this collection yet.',
  linkdrop: 'No drops created from this account yet.',
};

/** What the account already owns, above the form that creates more of it. */
export function HoldingsPanel({ kind }: { kind: ActionKind }) {
  const { signedAccountId, callFunction, signAndSendTransactions } = useNearWallet();
  const { network } = useNetwork();
  const accountId = signedAccountId ?? '';
  const contracts = ActionContracts[network];
  const queryClient = useQueryClient();
  const [busyDrop, setBusyDrop] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState<SendTarget | null>(null);
  const [openDrop, setOpenDrop] = useState<Row | null>(null);
  /** Contract ids ticked for a batch storage removal. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<{
    tokens: Removable[];
    label: string;
  } | null>(null);

  const ft = useHoldings(kind === 'ft' ? accountId : '');
  const storage = useFtStorage(kind === 'ft' ? accountId : '');
  const nft = useOwnedNfts(kind === 'nft' ? accountId : '');

  const drops = useDrops(kind === 'linkdrop' ? accountId : '');
  const keypomBalance = useKeypomBalance(kind === 'linkdrop' ? accountId : '');

  const run = async (label: string, body: () => Promise<unknown>, done: string) => {
    setBusyDrop(label);
    setNote(null);
    try {
      await body();
      setOpenDrop(null);
      setNote({ ok: true, text: done });
      refreshAfterTx(() => {
        setSelected(new Set());
        if (kind === 'ft') {
          queryClient.invalidateQueries({
            queryKey: ['holdings', network, accountId],
          });
          queryClient.invalidateQueries({
            queryKey: ['ft-storage', network, accountId],
          });
          return;
        }
        queryClient.invalidateQueries({
          queryKey: ['drops', network, accountId],
        });
        keypomBalance.refetch();
      });
    } catch (error) {
      setNote({ ok: false, text: describeError(error).message });
    } finally {
      setBusyDrop('');
    }
  };

  /** One confirm and one wallet prompt for any number of drops. */
  const deleteDrops = (list: KeypomDrop[], label: string) => {
    const local = list.filter((drop) => drop.locallyManaged);
    const keypom = list.filter((drop) => !drop.locallyManaged);
    const unclaimed = local.reduce((sum, drop) => sum + (drop.keys?.filter((key) => !key.claimed).length ?? 0), 0);
    const what = list.length === 1 ? `drop ${list[0].drop_id}` : `${list.length} drops`;
    const warnings = [
      keypom.length > 0 &&
        'Every link that has not been claimed stops working. The NEAR goes back to your Keypom balance, which you can then withdraw.',
      unclaimed > 0 && `${unclaimed} link(s) stored in this browser are still unclaimed and will be lost for good.`,
    ].filter(Boolean);
    if (!window.confirm(`Delete ${what}? ${warnings.join(' ')}`)) return;
    const call = (method: string, dropId: string) => ({
      receiverId: contracts.linkdrop.contractId,
      signerId: accountId,
      actions: [
        {
          type: 'FunctionCall' as const,
          params: { methodName: method, args: { drop_id: dropId }, gas: GAS_300.toString(), deposit: '0' },
        },
      ],
    });
    return run(
      label,
      async () => {
        // ponytail: near-drop has no delete API — forgetting is all this browser can do
        local.forEach((drop) => forgetDrop(network, drop.drop_id));
        if (keypom.length === 0) return;
        await signAndSendTransactions({
          transactions: keypom.flatMap((drop) => [
            // Assets first — Keypom refuses to delete a drop that still holds them.
            ...(drop.ft || drop.nft ? [call('refund_assets', drop.drop_id)] : []),
            // Deletes up to 100 keys per call, so a big drop needs more than one.
            call('delete_keys', drop.drop_id),
          ]),
        });
      },
      keypom.length > 0
        ? 'Deleted. A drop still listed had over 100 links — delete it again. The refund is in your Keypom balance.'
        : 'Removed from this browser.',
    );
  };

  /**
   * NEP-145 storage_unregister returns the registration's storage deposit. A
   * token still holding a balance needs force, which burns that balance.
   */
  const unregister = (removables: Removable[], label: string) => {
    const recovered = `${yoctoToNear(
      removables.reduce((sum, r) => sum + r.locked, 0n),
      5,
    )} Ⓝ`;
    return run(
      label,
      () =>
        signAndSendTransactions({
          transactions: removables.map(({ token: t }) => ({
            receiverId: t.contractId,
            signerId: accountId,
            actions: [
              {
                type: 'FunctionCall' as const,
                params: {
                  methodName: 'storage_unregister',
                  // A zero-balance token is never forced: if a transfer landed meanwhile, the call fails instead of burning it.
                  args: { force: t.balance > 0n },
                  gas: GAS.toString(),
                  deposit: '1',
                },
              },
            ],
          })),
        }),
      `Recovered ${recovered}.`,
    );
  };

  const withdraw = () =>
    run(
      'withdraw',
      () =>
        callFunction({
          contractId: contracts.linkdrop.contractId,
          method: 'withdraw_from_balance',
          args: {},
          gas: GAS_300.toString(),
        }),
      'Withdrawn to your account.',
    );

  if (!accountId) return null;

  const query = kind === 'ft' ? ft : kind === 'nft' ? nft : drops;
  const rows =
    kind === 'ft' ? ftRows(ft.data, storage.data) : kind === 'nft' ? nftRows(nft.data) : dropRows(drops.data);
  const selectable = rows.filter((row) => (kind === 'ft' ? row.removable : row.drop));
  // Rows vanish after a removal or refetch, so only count ticks that still have a row.
  const pickedRows = selectable.filter((row) => selected.has(row.key));
  const picked = pickedRows.flatMap((row) => (row.removable ? [row.removable] : []));
  const toggle = (contractId: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(contractId);
      else next.delete(contractId);
      return next;
    });

  return (
    <details className="card holdings-panel">
      <summary className="holdings-summary">
        <span className="holdings-title">
          <svg className="holdings-chevron" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path
              d="M5 3l6 5-6 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {titles[kind]}
        </span>
        {rows.length > 0 && <span className="meta">{rows.length}</span>}
      </summary>
      {query.isLoading && <p className="hint">Loading…</p>}
      {query.isError && <p className="hint error">Could not read this account&apos;s holdings.</p>}
      {query.isSuccess && rows.length === 0 && <p className="hint">{empty[kind]}</p>}
      {pickedRows.length > 0 && (
        <div className="holdings-bulk" role="toolbar" aria-label="Selected rows">
          <span>
            {pickedRows.length} selected
            {kind === 'ft' && (
              <>
                {' '}
                · recovers{' '}
                <strong>
                  {yoctoToNear(
                    picked.reduce((sum, r) => sum + r.locked, 0n),
                    5,
                  )}{' '}
                  Ⓝ
                </strong>
              </>
            )}
          </span>
          <span className="holdings-bulk-actions">
            <button className="btn btn-ghost" disabled={busyDrop.length > 0} onClick={() => setSelected(new Set())}>
              Clear
            </button>
            <button
              className="btn btn-danger"
              disabled={busyDrop.length > 0}
              onClick={() =>
                kind === 'ft'
                  ? setConfirming({ tokens: picked, label: 'selected' })
                  : deleteDrops(
                      pickedRows.map((row) => row.drop!),
                      'selected',
                    )
              }
            >
              <Trash2 aria-hidden />
              {busyDrop === 'selected'
                ? kind === 'ft'
                  ? 'Removing…'
                  : 'Deleting…'
                : `${kind === 'ft' ? 'Remove' : 'Delete'} ${pickedRows.length}`}
            </button>
          </span>
        </div>
      )}
      {rows.length > 0 && (
        <table className="holdings-table">
          <thead>
            <tr>
              {kind !== 'nft' && (
                <th className="holdings-check">
                  {selectable.length > 0 && (
                    <input
                      type="checkbox"
                      aria-label="Select every row"
                      checked={pickedRows.length === selectable.length}
                      onChange={(event) =>
                        setSelected(new Set(event.target.checked ? selectable.map((row) => row.key) : []))
                      }
                    />
                  )}
                </th>
              )}
              {columns[kind].map((column, i) => (
                <th key={column} className={i === 1 ? 'holdings-sub' : undefined}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={selected.has(row.key) ? 'is-selected' : undefined}>
                {kind !== 'nft' && (
                  <td className="holdings-check">
                    {selectable.includes(row) && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.label}`}
                        checked={selected.has(row.key)}
                        onChange={(event) => toggle(row.key, event.target.checked)}
                      />
                    )}
                  </td>
                )}
                <td className="holdings-name">
                  {row.icon ? (
                    <img className="holdings-icon" src={row.icon} alt="" />
                  ) : (
                    <span className="holdings-icon holdings-icon-fallback" aria-hidden>
                      {row.label.charAt(0)}
                    </span>
                  )}
                  {row.label}
                  {row.verified !== undefined && (
                    <span
                      className={row.verified ? 'holdings-verified is-verified' : 'holdings-verified'}
                      role="img"
                      aria-label={row.verified ? 'Verified' : 'Unverified'}
                      title={
                        row.verified
                          ? 'Verified: on the Ref Finance whitelist'
                          : 'Unverified: not on the Ref Finance whitelist'
                      }
                    >
                      {row.verified ? <BadgeCheck aria-hidden /> : <ShieldAlert aria-hidden />}
                    </span>
                  )}
                </td>
                <td className="holdings-sub" title={row.sub}>
                  {row.sub}
                </td>
                <td className="holdings-value">{row.value}</td>
                <td className="holdings-action">
                  {row.removable ? (
                    <button
                      className="btn btn-ghost holdings-icon-btn holdings-remove"
                      disabled={busyDrop.length > 0}
                      aria-label={`Remove ${row.label}`}
                      title={`Remove · recovers ${yoctoToNear(row.removable.locked, 5)} Ⓝ of storage`}
                      onClick={() =>
                        setConfirming({
                          tokens: [row.removable!],
                          label: row.key,
                        })
                      }
                    >
                      <Trash2 aria-hidden />
                    </button>
                  ) : row.drop ? (
                    <button
                      className="btn btn-ghost holdings-icon-btn holdings-remove"
                      disabled={busyDrop.length > 0}
                      aria-label={`Delete ${row.label}`}
                      title={row.drop.locallyManaged ? 'Remove from this browser' : 'Delete drop'}
                      onClick={() => deleteDrops([row.drop!], row.key)}
                    >
                      <Trash2 aria-hidden />
                    </button>
                  ) : (
                    kind === 'ft' && <span className="holdings-icon-slot" />
                  )}
                  {row.send?.kind === 'ft' && row.send.token.balance === 0n ? (
                    <span className="holdings-icon-slot" />
                  ) : (
                    <button
                      className="btn btn-ghost holdings-icon-btn"
                      aria-label={`${row.send ? 'Send' : 'Links for'} ${row.label}`}
                      title={row.send ? 'Send' : 'Links'}
                      onClick={() => (row.send ? setSending(row.send) : setOpenDrop(row))}
                    >
                      {row.send ? <Send aria-hidden /> : <Link aria-hidden />}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {kind === 'ft' && storage.isLoading && <p className="hint">Checking verification and storage…</p>}
      {kind === 'ft' && storage.isError && (
        <p className="hint error">Could not check verification or storage: {describeError(storage.error).message}</p>
      )}
      {kind === 'ft' && storage.data && (
        <p className="hint">
          <BadgeCheck className="hint-icon verified" aria-hidden /> on the Ref Finance whitelist ·{' '}
          <ShieldAlert className="hint-icon" aria-hidden /> not on it. Empty or unverified tokens can be removed to get
          back the NEAR locked as storage.
        </p>
      )}
      {confirming && (
        <RemoveTokensDialog
          tokens={confirming.tokens}
          onClose={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            unregister(confirming.tokens, confirming.label);
          }}
        />
      )}
      {sending && (
        <SendDialog
          target={sending}
          onClose={() => setSending(null)}
          onSent={() =>
            refreshAfterTx(() =>
              queryClient.invalidateQueries({
                queryKey: [kind === 'ft' ? 'holdings' : 'owned-nfts'],
              }),
            )
          }
        />
      )}
      {openDrop?.drop && (
        <DropDialog
          drop={openDrop.drop}
          name={openDrop.label}
          busy={busyDrop === openDrop.key}
          onDelete={() => deleteDrops([openDrop.drop!], openDrop.key)}
          onClose={() => setOpenDrop(null)}
        />
      )}
      {note && (
        <p className={note.ok ? 'hint' : 'hint error'} role="status">
          {note.text}
        </p>
      )}
      {kind === 'linkdrop' && BigInt(keypomBalance.data ?? '0') > 0n && (
        <p className="hint">
          {yoctoToNear(BigInt(keypomBalance.data ?? '0'), 4)} Ⓝ refunded into Keypom.{' '}
          <button className="btn btn-ghost" disabled={busyDrop.length > 0} onClick={withdraw}>
            <ArrowDownToLine aria-hidden />
            {busyDrop === 'withdraw' ? 'Withdrawing…' : 'Withdraw to my account'}
          </button>
        </p>
      )}
    </details>
  );
}

type Row = {
  key: string;
  label: string;
  sub: string;
  value: string;
  icon?: string;
  send?: SendTarget;
  drop?: KeypomDrop;
  verified?: boolean;
  /** Set when the token is empty or unverified and the account holds storage in it. */
  removable?: Removable;
};

const emptyToken = (contractId: string): HeldToken => ({
  contractId,
  symbol: contractId,
  decimals: 24,
  balance: 0n,
});

const ftRows = (tokens?: HeldToken[], storage?: FtStorage): Row[] => {
  const held = (tokens ?? []).filter((token) => token.contractId !== 'near');
  const empty = (storage?.empty ?? [])
    .filter((contractId) => !held.some((token) => token.contractId === contractId))
    .map(emptyToken);
  return [...held, ...empty].map((token) => {
    const locked = storage?.locked.get(token.contractId);
    const verified = storage?.verified.has(token.contractId);
    return {
      key: token.contractId,
      label: token.symbol,
      sub: token.contractId,
      value: groupDigits(fromUnits(token.balance, token.decimals)),
      icon: token.icon,
      send: { kind: 'ft', token },
      verified,
      removable: locked && (token.balance === 0n || !verified) ? { token, locked } : undefined,
    };
  });
};

/** 1000000.5 → 1,000,000.5 without going through Number, so big balances keep every digit. */
const groupDigits = (value: string) => {
  const [int, frac] = value.split('.');
  return BigInt(int).toLocaleString('en-US') + (frac ? `.${frac}` : '');
};

const nftRows = (tokens?: OwnedNft[]): Row[] =>
  (tokens ?? []).map((token) => ({
    key: token.token_id,
    label: token.metadata?.title || token.token_id,
    sub: token.token_id,
    value: token.owner_id ?? '',
    icon: token.metadata?.media,
    send: { kind: 'nft', token },
  }));

const dropRows = (drops?: KeypomDrop[]): Row[] =>
  (drops ?? []).map((drop) => ({
    key: drop.drop_id,
    drop,
    // ponytail: metadata is whatever the creator wrote — ours is {"dropName"}
    label: parseDropName(drop.metadata) || `Drop #${drop.drop_id}`,
    sub: drop.drop_id,
    value: drop.keys
      ? `${drop.keys.filter((key) => !key.claimed).length} of ${drop.keys.length} unclaimed`
      : `${drop.next_key_id ?? 0} created`,
  }));

function parseDropName(metadata?: string | null): string {
  try {
    return (JSON.parse(metadata ?? '') as { dropName?: string }).dropName ?? '';
  } catch {
    return '';
  }
}
