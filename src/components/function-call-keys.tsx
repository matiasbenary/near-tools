'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Actions, useNearWallet } from 'near-connect-hooks';
import { KeyRound, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import { yoctoToNear } from 'near-api-js';
import { useNetwork } from '@/components/app-providers';
import { describeError } from '@/lib/errors';
import { RpcUrls } from '@/config';

type FunctionCallPermission = {
  allowance?: string | bigint | null;
  method_names: string[];
  receiver_id: string;
};

type FunctionCallKey = {
  publicKey: string;
  nonce: string;
  permission: FunctionCallPermission;
};

function shortKey(key: string) {
  const [kind, value = key] = key.split(':');
  return `${kind}:…${value.slice(-10)}`;
}

function allowanceLabel(allowance: FunctionCallPermission['allowance']) {
  if (allowance === undefined || allowance === null) return 'Unlimited';
  try {
    return `${yoctoToNear(BigInt(String(allowance)), 5)} Ⓝ`;
  } catch {
    return String(allowance);
  }
}

type RawAccessKey = {
  public_key: string;
  access_key: { nonce: number; permission: 'FullAccess' | { FunctionCall: FunctionCallPermission } };
};

// Nodes ≥2.14 (testnet) reject >100 keys unless paginated with limit/after_key.
// Older nodes (mainnet 2.13) ignore both params and return everything without last_key.
async function fetchAccessKeys(rpcUrl: string, accountId: string) {
  const all: RawAccessKey[] = [];
  let afterKey: string | undefined;
  do {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'query',
        params: { request_type: 'view_access_key_list', finality: 'final', account_id: accountId, limit: 100, after_key: afterKey },
      }),
    }).then((r) => r.json());
    if (res.error) throw new Error(res.error.data ?? res.error.message);
    all.push(...res.result.keys);
    afterKey = res.result.keys.length ? res.result.last_key : undefined;
  } while (afterKey);
  return all;
}

export function FunctionCallKeys() {
  const { network } = useNetwork();
  const { signedAccountId, signAndSendTransaction, signAndSendTransactions } = useNearWallet();
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<FunctionCallKey[] | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const queryKey = ['function-call-keys', network, signedAccountId] as const;
  const query = useQuery({
    queryKey,
    enabled: !!signedAccountId,
    queryFn: async (): Promise<FunctionCallKey[]> => {
      const keys = await fetchAccessKeys(RpcUrls[network][0], signedAccountId);
      return keys.flatMap(({ public_key, access_key }) => {
        const permission = access_key.permission;
        if (permission === 'FullAccess' || !('FunctionCall' in permission)) return [];
        return [{
          publicKey: public_key,
          nonce: String(access_key.nonce),
          permission: permission.FunctionCall as FunctionCallPermission,
        }];
      });
    },
  });

  useEffect(() => {
    if (pending) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [pending]);

  const closeDialog = () => {
    if (!working) setPending(null);
  };

  const revoke = async () => {
    if (!pending?.length) return;
    const removing = pending;
    setWorking(true);
    setNotice(null);
    try {
      const actions = removing.map(({ publicKey }) => Actions.deleteKey(publicKey));
      if (actions.length <= 80) {
        await signAndSendTransaction({ receiverId: signedAccountId, actions });
      } else {
        const transactions = [];
        for (let i = 0; i < actions.length; i += 80)
          transactions.push({ receiverId: signedAccountId, actions: actions.slice(i, i + 80) });
        await signAndSendTransactions({ transactions });
      }
      const removed = new Set(removing.map(({ publicKey }) => publicKey));
      queryClient.setQueryData<FunctionCallKey[]>(queryKey, (old = []) =>
        old.filter(({ publicKey }) => !removed.has(publicKey))
      );
      setNotice({
        ok: true,
        text: removing.length === 1 ? 'Function-call key revoked.' : `${removing.length} function-call keys revoked.`,
      });
      setPending(null);
      setTimeout(() => queryClient.invalidateQueries({ queryKey }), 3_000);
    } catch (error) {
      setNotice({ ok: false, text: describeError(error).message });
    } finally {
      setWorking(false);
    }
  };

  const keys = query.data ?? [];

  return (
    <section className="keys-shell" aria-labelledby="keys-title">
      <header className="keys-header">
        <div>
          <p className="wizard-kicker">{network} account security</p>
          <h1 id="keys-title">Function-call keys</h1>
          <p>Restricted keys let apps call specific contracts without holding full control of your account.</p>
        </div>
        <div className="keys-account">
          <span>{signedAccountId}</span>
          <small>{query.isLoading ? 'Checking…' : `${keys.length} active`}</small>
        </div>
      </header>

      <div className="keys-toolbar">
        <p>Full-access keys are excluded from this list and cannot be deleted from this page.</p>
        <div className="keys-toolbar-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label="Refresh keys"
            title="Refresh keys"
            disabled={query.isFetching}
            onClick={() => query.refetch()}
          >
            <RefreshCw size={16} aria-hidden className={query.isFetching ? 'spin' : ''} />
          </button>
          <button
            type="button"
            className="btn btn-danger-ghost"
            disabled={query.isLoading || keys.length === 0}
            onClick={() => setPending(keys)}
          >
            <Trash2 size={15} aria-hidden />
            Delete all
          </button>
        </div>
      </div>

      {notice && <p className={`keys-notice ${notice.ok ? 'ok' : 'error'}`} role="status">{notice.text}</p>}

      {query.isLoading ? (
        <div className="keys-loading" aria-busy="true" aria-label="Loading function-call keys">
          {[0, 1, 2].map((item) => <span key={item} />)}
        </div>
      ) : query.isError ? (
        <div className="keys-empty keys-error" role="alert">
          <KeyRound aria-hidden />
          <h2>Keys could not be loaded</h2>
          <p>{describeError(query.error).message}</p>
          <button type="button" className="btn btn-ghost" onClick={() => query.refetch()}>Try again</button>
        </div>
      ) : keys.length === 0 ? (
        <div className="keys-empty">
          <ShieldCheck aria-hidden />
          <h2>No function-call keys</h2>
          <p>This account has no restricted app permissions to revoke.</p>
        </div>
      ) : (
        <div className="keys-list">
          {keys.map((key) => {
            const { receiver_id: receiver, method_names: methods, allowance } = key.permission;
            return (
              <article className="key-row" key={key.publicKey}>
                <div className="key-icon" aria-hidden><KeyRound size={18} /></div>
                <div className="key-main">
                  <div className="key-title">
                    <h2>{receiver}</h2>
                    <code title={key.publicKey}>{shortKey(key.publicKey)}</code>
                  </div>
                  <dl className="key-details">
                    <div>
                      <dt>Methods</dt>
                      <dd>{methods.length ? methods.join(', ') : 'All methods'}</dd>
                    </div>
                    <div>
                      <dt>Allowance</dt>
                      <dd>{allowanceLabel(allowance)}</dd>
                    </div>
                    <div>
                      <dt>Nonce</dt>
                      <dd>{key.nonce}</dd>
                    </div>
                  </dl>
                </div>
                <button
                  type="button"
                  className="icon-btn danger"
                  aria-label={`Delete key for ${receiver}`}
                  title="Delete key"
                  onClick={() => setPending([key])}
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              </article>
            );
          })}
        </div>
      )}

      <dialog className="confirm-dialog key-confirm-dialog" ref={dialogRef} onClose={closeDialog}>
        {pending && (
          <>
            <header className="holding-dialog-head">
              <div>
                <p className="wizard-kicker">Irreversible action</p>
                <h2>{pending.length === 1 ? 'Delete this key?' : `Delete all ${pending.length} keys?`}</h2>
              </div>
              <button type="button" className="icon-btn" aria-label="Close" disabled={working} onClick={() => dialogRef.current?.close()}>
                <X aria-hidden />
              </button>
            </header>
            <p className="key-confirm-copy">
              {pending.length === 1
                ? `${pending[0].permission.receiver_id} will lose its authorized access.`
                : 'Every app listed on this page will lose its authorized access. Full-access keys will stay untouched.'}
            </p>
            {pending.length === 1 && <code className="key-confirm-value">{pending[0].publicKey}</code>}
            <div className="confirm-actions">
              <button type="button" className="btn btn-ghost" disabled={working} onClick={() => dialogRef.current?.close()}>Cancel</button>
              <button type="button" className="btn btn-danger" disabled={working} onClick={revoke}>
                {working ? 'Confirm in wallet…' : pending.length === 1 ? 'Delete key' : 'Delete all keys'}
              </button>
            </div>
          </>
        )}
      </dialog>
    </section>
  );
}
