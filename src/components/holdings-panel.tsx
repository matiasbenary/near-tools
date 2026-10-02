'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNearWallet } from 'near-connect-hooks';
import { BadgeCheck, Link, ShieldAlert, Trash2 } from 'lucide-react';
import { useNetwork } from '@/components/app-providers';
import { IPFS } from '@/hooks/use-avatar';
import { ConfirmDialog, DropDialog, Removable, RemoveTokensDialog } from '@/components/holding-dialogs';
import {
  HeldToken,
  Linkdrop,
  OwnedNft,
  useDrops,
  useFtVerification,
  useHoldings,
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
  nft: ['NFT', 'Token ID', 'Owner'],
  linkdrop: ['Drop', 'Drop ID', 'Links', 'Action'],
};

const empty: Record<ActionKind, string> = {
  ft: 'No fungible tokens on this account yet.',
  nft: 'No NFTs minted from this collection yet.',
  linkdrop: 'No drops created from this account yet.',
};

/** What the account already owns, above the form that creates more of it. */
export function HoldingsPanel({ kind }: { kind: ActionKind }) {
  const { signedAccountId, signAndSendTransactions } = useNearWallet();
  const { network } = useNetwork();
  const accountId = signedAccountId ?? '';
  const contracts = ActionContracts[network];
  const queryClient = useQueryClient();
  const [busyDrop, setBusyDrop] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [openDrop, setOpenDrop] = useState<Row | null>(null);
  /** Contract ids ticked for a batch storage removal. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<{
    tokens: Removable[];
    label: string;
  } | null>(null);
  const [asking, setAsking] = useState<{ title: string; text: string; go: () => void } | null>(null);

  const ft = useHoldings(kind === 'ft' ? accountId : '');
  const verification = useFtVerification(kind === 'ft' ? accountId : '');
  const nft = useOwnedNfts(kind === 'nft' ? accountId : '');

  const drops = useDrops(kind === 'linkdrop' ? accountId : '');

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
      });
    } catch (error) {
      setNote({ ok: false, text: describeError(error).message });
    } finally {
      setBusyDrop('');
    }
  };

  /** Cancel remaining keys on-chain before removing this browser's copies. */
  const deleteDrops = (list: Linkdrop[], label: string) => {
    const active = list.filter((drop) => drop.exists);
    const what = list.length === 1 ? `drop ${list[0].drop_id}` : `${list.length} drops`;
    setAsking({ title: `Delete ${what}?`,
      text: active.length > 0
        ? 'Remaining links stop working. Unused NEAR or FT assets and budgets are refunded directly to your account. NFTs remain yours; you can revoke their approval separately.'
        : 'All links are already claimed or cancelled. Remove their records from this browser?',
      go: () => run(label, async () => {
        if (active.length > 0) await signAndSendTransactions({
          transactions: active.map((drop) => ({
            receiverId: contracts.linkdrop.contractId, signerId: accountId,
            actions: [{ type: 'FunctionCall' as const, params: { methodName: 'delete_drop',
              args: { drop_id: Number(drop.drop_id) }, gas: GAS_300.toString(), deposit: '0' } }],
          })),
        });
        list.forEach((drop) => forgetDrop({ network, contractId: contracts.linkdrop.contractId, accountId }, drop.drop_id));
      }, active.length > 0 ? 'Deleted. Refunds go directly to your account.' : 'Removed from this browser.'),
    });
  };

  /**
   * NEP-145 storage_unregister returns the registration's storage deposit. A
   * token still holding a balance needs force, which burns that balance.
   */
  const unregister = (removables: Removable[], label: string) => {
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
      'Removal transaction completed.',
    );
  };

  if (!accountId) return null;

  const query = kind === 'ft' ? ft : kind === 'nft' ? nft : drops;
  const rows =
    kind === 'ft' ? ftRows(ft.data, verification.data) : kind === 'nft' ? nftRows(nft.data) : dropRows(drops.data);
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
      {query.isError && <p className="hint error">{kind === 'ft'
        ? 'Could not refresh this account’s holdings. Previously loaded balances may be out of date.'
        : 'Could not read this account’s holdings.'}</p>}
      {kind === 'ft' && ft.data?.some((token) => token.stale) && (
        <p className="hint">Some token balances could not be refreshed. Showing their last available balances.</p>
      )}
      {query.isSuccess && rows.length === 0 && <p className="hint">{empty[kind]}</p>}
      {pickedRows.length > 0 && (
        <div className="holdings-bulk" role="toolbar" aria-label="Selected rows">
          <span>{pickedRows.length} selected</span>
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
                {kind !== 'nft' && (
                  <td className="holdings-action">
                    {row.removable ? (
                      <button
                        className="btn btn-ghost holdings-icon-btn holdings-remove"
                        disabled={busyDrop.length > 0}
                        aria-label={`Remove ${row.label}`}
                        title="Remove token"
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
                        title={row.drop.exists ? 'Delete drop & refund' : 'Remove from this browser'}
                        onClick={() => deleteDrops([row.drop!], row.key)}
                      >
                        <Trash2 aria-hidden />
                      </button>
                    ) : (
                      kind === 'ft' && <span className="holdings-icon-slot" />
                    )}
                    {row.drop && (
                      <button
                        className="btn btn-ghost holdings-icon-btn"
                        aria-label={`Links for ${row.label}`}
                        title="Links"
                        onClick={() => setOpenDrop(row)}
                      >
                        <Link aria-hidden />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {kind === 'ft' && verification.isLoading && <p className="hint">Checking verification…</p>}
      {kind === 'ft' && verification.isError && (
        <p className="hint error">Could not check verification: {describeError(verification.error).message}</p>
      )}
      {kind === 'ft' && verification.data && (
        <p className="hint">
          <BadgeCheck className="hint-icon verified" aria-hidden /> on the Ref Finance whitelist ·{' '}
          <ShieldAlert className="hint-icon" aria-hidden /> not on it. Empty or unverified tokens can be selected for removal.
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
      {asking && (
        <ConfirmDialog
          title={asking.title}
          text={asking.text}
          confirmLabel="Delete"
          onClose={() => setAsking(null)}
          onConfirm={() => {
            setAsking(null);
            asking.go();
          }}
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

    </details>
  );
}

type Row = {
  key: string;
  label: string;
  sub: string;
  value: string;
  icon?: string;
  drop?: Linkdrop;
  verified?: boolean;
  /** Empty or unverified tokens can attempt removal without storage preflight checks. */
  removable?: Removable;
};

const ftRows = (tokens?: HeldToken[], whitelist?: string[]): Row[] => {
  const verifiedTokens = whitelist ? new Set(whitelist) : undefined;
  return (tokens ?? []).filter((token) => token.contractId !== 'near').map((token) => {
    const verified = verifiedTokens?.has(token.contractId);
    return {
      key: token.contractId,
      label: token.symbol,
      sub: token.contractId,
      // Dust rounds to 0 at 4 places; say so, or it looks removable without burning anything.
      value: token.balance > 0n && fromUnits(token.balance, token.decimals) === '0' ? '< 0.0001' : groupDigits(fromUnits(token.balance, token.decimals)),
      icon: token.icon,
      verified,
      removable: token.balance === 0n || verified === false ? { token } : undefined,
    };
  }).sort((a, b) => Number(b.verified === true) - Number(a.verified === true));
};

/** 1000000.5 → 1,000,000.5 without going through Number, so big balances keep every digit. */
const groupDigits = (value: string) => {
  const [int, frac] = value.split('.');
  return BigInt(int).toLocaleString('en-US') + (frac ? `.${frac}` : '');
};

// ponytail: a bare CID is relative to the collection's base_uri; assume IPFS instead of fetching nft_metadata
const nftMedia = (media?: string) =>
  media && !/^(https?:|data:|ipfs:)/.test(media) ? `${IPFS}/ipfs/${media}` : media;

const nftRows = (tokens?: OwnedNft[]): Row[] =>
  (tokens ?? []).map((token) => ({
    key: token.token_id,
    label: token.metadata?.title || token.token_id,
    sub: token.token_id,
    value: token.owner_id ?? '',
    icon: nftMedia(token.metadata?.media),
  }));

const dropRows = (drops?: Linkdrop[]): Row[] =>
  (drops ?? []).map((drop) => ({
    key: drop.drop_id, drop, label: drop.name || `Drop #${drop.drop_id}`,
    sub: drop.drop_id,
    value: !drop.exists ? 'Claimed or cancelled'
      : !drop.ready ? 'Awaiting asset funding'
      : `${drop.keys.filter((key) => !key.claimed).length} of ${drop.keys.length} unclaimed`,
  }));
