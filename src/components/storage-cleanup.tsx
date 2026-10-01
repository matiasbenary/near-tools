'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useNearWallet } from 'near-connect-hooks';
import { yoctoToNear } from 'near-api-js';
import { useNetwork } from '@/components/app-providers';
import { useFtStorage, useKeypomBalance } from '@/hooks/use-holdings';
import { describeError } from '@/lib/errors';
import { GAS, refreshAfterTx } from '@/lib/near';
import { NetworkConfig, RpcUrls } from '@/config';

/** 1 byte of state locks 10^19 yoctoNEAR (protocol storage price). */
const BYTE_COST = 10n ** 19n;

const near = (amount: bigint) => `${yoctoToNear(amount, 5)} Ⓝ`;

/** NEAR locked for storage around the account, and where each part can be recovered. */
export function StorageCleanup() {
  const { signedAccountId, viewFunction, callFunction } = useNearWallet();
  const { network } = useNetwork();
  const accountId = signedAccountId ?? '';
  const socialDb = NetworkConfig[network].socialDb;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const ft = useFtStorage(accountId);
  const keypom = useKeypomBalance(accountId);
  const social = useQuery({
    queryKey: ['social-storage', network, accountId],
    enabled: accountId.length > 0,
    queryFn: async () => {
      const balance = (await viewFunction({
        contractId: socialDb,
        method: 'storage_balance_of',
        args: { account_id: accountId },
      })) as { available?: string } | null;
      return BigInt(balance?.available ?? '0');
    },
  });
  const account = useQuery({
    queryKey: ['account-storage', network, accountId],
    enabled: accountId.length > 0,
    queryFn: async () => {
      const res = await fetch(RpcUrls[network][0], {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'query',
          params: { request_type: 'view_account', finality: 'final', account_id: accountId },
        }),
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error.data ?? res.error.message);
      return BigInt(res.result.storage_usage) * BYTE_COST;
    },
  });

  // Only empty registrations: unregistering a token with a balance burns it, so /ft asks first.
  const ftLocked = (ft.data?.empty ?? []).reduce((sum, id) => sum + (ft.data?.locked.get(id) ?? 0n), 0n);
  const keypomBalance = BigInt(keypom.data ?? '0');
  const socialAvailable = social.data ?? 0n;
  const total = ftLocked + keypomBalance + socialAvailable;
  const loading = ft.isLoading || keypom.isLoading || social.isLoading;

  const withdrawSocial = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await callFunction({
        contractId: socialDb,
        method: 'storage_withdraw',
        args: {},
        gas: GAS.toString(),
        deposit: '1',
      });
      setNotice({ ok: true, text: `Recovered ${near(socialAvailable)} from SocialDB.` });
      refreshAfterTx(() => social.refetch());
    } catch (error) {
      setNotice({ ok: false, text: describeError(error).message });
    } finally {
      setBusy(false);
    }
  };

  const rows = [
    {
      label: 'Empty token registrations',
      detail: `${ft.data?.empty.length ?? 0} tokens with a zero balance`,
      amount: ftLocked,
      action: ftLocked > 0n && <Link className="btn btn-ghost" href="/ft">Review in FT</Link>,
    },
    {
      label: 'Keypom balance',
      detail: 'Refunds from deleted drops',
      amount: keypomBalance,
      action: keypomBalance > 0n && <Link className="btn btn-ghost" href="/linkdrop">Withdraw in Linkdrop</Link>,
    },
    {
      label: 'SocialDB storage',
      detail: `Unused deposit on ${socialDb}`,
      amount: socialAvailable,
      action: socialAvailable > 0n && (
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={withdrawSocial}>
          {busy ? 'Withdrawing…' : 'Withdraw'}
        </button>
      ),
    },
  ];

  return (
    <section className="keys-shell storage-shell" aria-labelledby="storage-title">
      <header className="keys-header">
        <div>
          <p className="wizard-kicker">{network} account cleanup</p>
          <h1 id="storage-title">Recoverable storage</h1>
          <p>NEAR locked as storage deposits in other contracts that you can take back.</p>
        </div>
        <div className="keys-account">
          <span>{loading ? 'Checking…' : near(total)}</span>
          <small>recoverable</small>
        </div>
      </header>

      {notice && <p className={`keys-notice ${notice.ok ? 'ok' : 'error'}`} role="status">{notice.text}</p>}

      <div className="storage-list">
        {rows.map((row) => (
          <div className="storage-row" key={row.label}>
            <div>
              <strong>{row.label}</strong>
              <small>{row.detail}</small>
            </div>
            <span className="storage-amount">{loading ? '…' : near(row.amount)}</span>
            <span>{row.action}</span>
          </div>
        ))}
        <div className="storage-row">
          <div>
            <strong>This account&apos;s own state</strong>
            <small>Locked while the data exists: keys, contract code and storage</small>
          </div>
          <span className="storage-amount">{account.data === undefined ? '…' : near(account.data)}</span>
          <span />
        </div>
      </div>
    </section>
  );
}
