'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNearWallet } from 'near-connect-hooks';
import { yoctoToNear } from 'near-api-js';
import { ArrowDownToLine, Link, Send } from 'lucide-react';
import { useNetwork } from '@/components/app-providers';
import { DropDialog, SendDialog, SendTarget } from '@/components/holding-dialogs';
import {
  HeldToken,
  KeypomDrop,
  OwnedNft,
  useDrops,
  useHoldings,
  useKeypomBalance,
  useOwnedNfts,
} from '@/hooks/use-holdings';
import { ActionContracts, ActionKind, fromUnits } from '@/lib/actions/contracts';
import { forgetDrop } from '@/lib/actions/linkdrop-keys';
import { describeError } from '@/lib/errors';
import { GAS_300, refreshAfterTx } from '@/lib/near';

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
  const { signedAccountId, callFunction } = useNearWallet();
  const { network } = useNetwork();
  const accountId = signedAccountId ?? '';
  const contracts = ActionContracts[network];
  const queryClient = useQueryClient();
  const [busyDrop, setBusyDrop] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState<SendTarget | null>(null);
  const [openDrop, setOpenDrop] = useState<Row | null>(null);

  const ft = useHoldings(kind === 'ft' ? accountId : '');
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
        queryClient.invalidateQueries({ queryKey: ['drops', network, accountId] });
        keypomBalance.refetch();
      });
    } catch (error) {
      setNote({ ok: false, text: describeError(error).message });
    } finally {
      setBusyDrop('');
    }
  };

  const deleteDrop = (drop: KeypomDrop) => {
    const dropId = drop.drop_id;
    const hasAssets = !!drop.ft || !!drop.nft;
    if (drop.locallyManaged) {
      const open = drop.keys?.filter((key) => !key.claimed).length ?? 0;
      if (open > 0 && !window.confirm(`${open} link(s) are still unclaimed. Forgetting the drop loses them for good. Continue?`))
        return;
      // ponytail: near-drop has no delete API — forgetting is all this browser can do
      return run(dropId, async () => forgetDrop(network, dropId), 'Drop removed from this browser.');
    }
    if (
      !window.confirm(
        `Delete drop ${dropId}? Every link that has not been claimed stops working. ` +
          'The NEAR goes back to your Keypom balance, which you can then withdraw.'
      )
    )
      return;
    // ponytail: assets first — Keypom refuses to delete a drop that still holds them
    return run(
      dropId,
      async () => {
        if (hasAssets) {
          await callFunction({
            contractId: contracts.linkdrop.contractId,
            method: 'refund_assets',
            args: { drop_id: dropId },
            gas: GAS_300.toString(),
          });
        }
        // Deletes up to 100 keys per call, so a big drop needs more than one.
        await callFunction({
          contractId: contracts.linkdrop.contractId,
          method: 'delete_keys',
          args: { drop_id: dropId },
          gas: GAS_300.toString(),
        });
      },
      'Deleted. If the drop is still listed it had over 100 links — delete it again. The refund is in your Keypom balance.'
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
      'Withdrawn to your account.'
    );

  if (!accountId) return null;

  const query = kind === 'ft' ? ft : kind === 'nft' ? nft : drops;
  const rows =
    kind === 'ft' ? ftRows(ft.data) : kind === 'nft' ? nftRows(nft.data) : dropRows(drops.data);

  return (
    <details className="card holdings-panel">
      <summary className="holdings-summary">
        <span className="holdings-title">
          <svg className="holdings-chevron" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M5 3l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {titles[kind]}
        </span>
        {rows.length > 0 && <span className="meta">{rows.length}</span>}
      </summary>
      {query.isLoading && <p className="hint">Loading…</p>}
      {query.isError && <p className="hint error">Could not read this account&apos;s holdings.</p>}
      {query.isSuccess && rows.length === 0 && <p className="hint">{empty[kind]}</p>}
      {rows.length > 0 && (
        <table className="holdings-table">
          <thead>
            <tr>
              {columns[kind].map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="holdings-name">
                  {row.icon && <img className="holdings-icon" src={row.icon} alt="" />}
                  {row.label}
                </td>
                <td className="holdings-sub">{row.sub}</td>
                <td className="holdings-value">{row.value}</td>
                <td className="holdings-action">
                  <button
                    className="btn btn-ghost"
                    onClick={() => (row.send ? setSending(row.send) : setOpenDrop(row))}
                  >
                    {row.send ? <Send aria-hidden /> : <Link aria-hidden />}
                    {row.send ? 'Send' : 'Links'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {sending && (
        <SendDialog
          target={sending}
          onClose={() => setSending(null)}
          onSent={() =>
            refreshAfterTx(() => queryClient.invalidateQueries({ queryKey: [kind === 'ft' ? 'holdings' : 'owned-nfts'] }))
          }
        />
      )}
      {openDrop?.drop && (
        <DropDialog
          drop={openDrop.drop}
          name={openDrop.label}
          busy={busyDrop === openDrop.key}
          onDelete={() => deleteDrop(openDrop.drop!)}
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
};

const ftRows = (tokens?: HeldToken[]): Row[] =>
  (tokens ?? [])
    .filter((token) => token.contractId !== 'near')
    .map((token) => ({
      key: token.contractId,
      label: token.symbol,
      sub: token.contractId,
      value: fromUnits(token.balance, token.decimals),
      icon: token.icon,
      send: { kind: 'ft', token },
    }));

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
