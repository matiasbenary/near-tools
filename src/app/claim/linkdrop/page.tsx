'use client';

import { useEffect, useMemo, useState } from 'react';
import { useNearWallet } from 'near-connect-hooks';
import { useQuery } from '@tanstack/react-query';
import { Account, KeyPair, type KeyPairString, yoctoToNear } from 'near-api-js';
import { useNetwork } from '@/components/app-providers';
import { ActionContracts, fromUnits } from '@/lib/actions/contracts';
import { claimAborted, claimGas, DEFAULT_CLAIM_GAS } from '@/lib/actions/linkdrop-keys';
import { describeError, rawError } from '@/lib/errors';
import { txHashOf } from '@/lib/near';
import { NetworkConfig, RpcUrls } from '@/config';
import { TxLink } from '@/components/result-sheet';

/** The contract returns the allowance as a JSON number, so it arrives in exponent form. */
const toBigInt = (value: number | string) => BigInt(Number(value).toLocaleString('fullwide', { useGrouping: false }));

/** near-api-js throws a TransactionExecutionError, which carries the hash. */
const txHashOfError = (error: unknown) => {
  const hash = (error as { txHash?: string })?.txHash;
  return hash || null;
};

/**
 * create_account_and_claim runs create_account (28 TGas) plus a 55 TGas callback.
 * The key's 0.1 Ⓝ allowance caps it near 98 TGas on testnet (billed at 10x), so
 * 90 leaves room for the outer call without overrunning the allowance.
 */
const CREATE_ACCOUNT_GAS = 90_000_000_000_000n;

/** `status.SuccessValue` is base64 of the returned JSON — here, `true` or `false`. */
const claimReturnedFalse = (outcome: unknown) => {
  const value = (outcome as { status?: { SuccessValue?: string } })?.status?.SuccessValue;
  return typeof value === 'string' && atob(value) === 'false';
};

type DropInformation = {
  drop_id: string;
  metadata?: string | null;
  required_gas?: string;
  ft?: { contract_id: string; balance_per_use: string };
  nft?: { contract_id: string };
};

type Preview = { gas: bigint; requiredGas: bigint } & (
  | { kind: 'ft'; symbol: string; amount: string; icon?: string; contractId: string }
  | { kind: 'nft'; title: string; media?: string; contractId: string; tokenId: string }
  | { kind: 'near'; amount: string }
);

type NearDrop =
  | { NEAR: { amount: string } }
  | { FT: { amount: string; ft_contract: string } }
  | { NFT: { token_id: string; nft_contract: string } };

function DropPreview({ preview }: { preview: Preview }) {
  return (
    <div className="claim-preview">
      {preview.kind === 'near' && (
        <p className="claim-amount">
          {preview.amount} <span>Ⓝ</span>
        </p>
      )}
      {preview.kind === 'ft' && (
        <>
          {preview.icon && <img className="claim-media" src={preview.icon} alt="" />}
          <p className="claim-amount">
            {preview.amount} <span>{preview.symbol}</span>
          </p>
          <p className="meta">{preview.contractId}</p>
        </>
      )}
      {preview.kind === 'nft' && (
        <>
          {preview.media && <img className="claim-media" src={preview.media} alt="" />}
          <p className="claim-amount">{preview.title}</p>
          <p className="meta">
            {preview.contractId} · {preview.tokenId}
          </p>
        </>
      )}
    </div>
  );
}

/** What the link pays out, and the gas its key can afford to claim it with. */
function useClaimableDrop(publicKey: string | null) {
  const { network } = useNetwork();
  const { viewFunction, provider } = useNearWallet();
  const contracts = ActionContracts[network];

  return useQuery({
    queryKey: ['claim', network, publicKey],
    enabled: !!publicKey,
    retry: false,
    // A claim deletes the key, so a refetch would only replace the preview with "not found".
    staleTime: Infinity,
    queryFn: async (): Promise<Preview> => {
      if (contracts.linkdrop.provider === 'near-drop') {
        const dropId = (await viewFunction({
          contractId: contracts.linkdrop.contractId,
          method: 'get_drop_id_by_key',
          args: { public_key: publicKey },
        })) as number;
        const drop = (await viewFunction({
          contractId: contracts.linkdrop.contractId,
          method: 'get_drop_by_id',
          args: { drop_id: dropId },
        })) as NearDrop;
        const gas = 25_000_000_000_000n;

        if ('FT' in drop) {
          const metadata = (await viewFunction({
            contractId: drop.FT.ft_contract,
            method: 'ft_metadata',
          })) as { symbol?: string; decimals?: number; icon?: string };
          return {
            gas,
            requiredGas: gas,
            kind: 'ft',
            symbol: metadata.symbol ?? drop.FT.ft_contract,
            amount: fromUnits(BigInt(drop.FT.amount), metadata.decimals ?? 24),
            icon: metadata.icon,
            contractId: drop.FT.ft_contract,
          };
        }
        if ('NFT' in drop) {
          const token = drop.NFT.token_id
            ? ((await viewFunction({
                contractId: drop.NFT.nft_contract,
                method: 'nft_token',
                args: { token_id: drop.NFT.token_id },
              }).catch(() => null)) as { metadata?: { title?: string; media?: string } } | null)
            : null;
          return {
            gas,
            requiredGas: gas,
            kind: 'nft',
            title: token?.metadata?.title || drop.NFT.token_id || 'NFT',
            media: token?.metadata?.media,
            contractId: drop.NFT.nft_contract,
            tokenId: drop.NFT.token_id,
          };
        }
        return {
          gas,
          requiredGas: gas,
          kind: 'near',
          amount: yoctoToNear(BigInt(drop.NEAR.amount), 4),
        };
      }

      const [information, keyInformation, gasPrice] = await Promise.all([
        viewFunction({
          contractId: contracts.linkdrop.contractId,
          method: 'get_drop_information',
          args: { key: publicKey },
        }) as Promise<DropInformation>,
        viewFunction({
          contractId: contracts.linkdrop.contractId,
          method: 'get_key_information',
          args: { key: publicKey },
        }).catch(() => null) as Promise<{ allowance?: number | string } | null>,
        provider.viewGasPrice().then((price) => BigInt(price.gas_price)),
      ]);

      const requiredGas = information.required_gas
        ? BigInt(information.required_gas)
        : DEFAULT_CLAIM_GAS;
      // No allowance to size against: the drop's own required_gas is the only
      // amount the contract accepts, so send that and let it decide.
      const gas = keyInformation?.allowance
        ? claimGas(toBigInt(keyInformation.allowance), gasPrice, requiredGas, network)
        : requiredGas;

      if (information.ft) {
        const metadata = (await viewFunction({
          contractId: information.ft.contract_id,
          method: 'ft_metadata',
        })) as { symbol?: string; decimals?: number; icon?: string };
        return {
          gas,
          requiredGas,
          kind: 'ft',
          symbol: metadata.symbol ?? information.ft.contract_id,
          amount: fromUnits(BigInt(information.ft.balance_per_use), metadata.decimals ?? 24),
          icon: metadata.icon ?? undefined,
          contractId: information.ft.contract_id,
        };
      }

      if (information.nft) {
        const tokenIds = (await viewFunction({
          contractId: contracts.linkdrop.contractId,
          method: 'get_nft_token_ids_for_drop',
          args: { drop_id: information.drop_id },
        })) as string[];
        const tokenId = tokenIds[0] ?? '';
        const token = tokenId
          ? ((await viewFunction({
              contractId: information.nft.contract_id,
              method: 'nft_token',
              args: { token_id: tokenId },
            }).catch(() => null)) as { metadata?: { title?: string; media?: string } } | null)
          : null;
        return {
          gas,
          requiredGas,
          kind: 'nft',
          title: token?.metadata?.title || tokenId || 'NFT',
          media: token?.metadata?.media,
          contractId: information.nft.contract_id,
          tokenId,
        };
      }

      const balance = (await viewFunction({
        contractId: contracts.linkdrop.contractId,
        method: 'get_key_balance',
        args: { key: publicKey },
      })) as string;
      return { gas, requiredGas, kind: 'near', amount: yoctoToNear(BigInt(balance), 4) };
    },
  });
}

export default function ClaimPage() {
  const { network } = useNetwork();
  const { signedAccountId, signIn, provider } = useNearWallet();
  const contracts = ActionContracts[network];
  const [secretKey, setSecretKey] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<{ message: string; detail: string } | null>(null);
  const [claimedInto, setClaimedInto] = useState<string | null>(null);
  const [newAccount, setNewAccount] = useState('');
  const [createdAccount, setCreatedAccount] = useState(false);
  const [claimTxHash, setClaimTxHash] = useState<string | null>(null);

  // ponytail: window.location over useSearchParams — the latter needs a Suspense
  // boundary under `output: export`, and this page has exactly one parameter.
  useEffect(() => {
    setSecretKey(new URLSearchParams(window.location.search).get('id'));
  }, []);

  const publicKey = useMemo(() => {
    if (!secretKey) return null;
    try {
      return KeyPair.fromString(secretKey as KeyPairString).getPublicKey().toString();
    } catch {
      return null;
    }
  }, [secretKey]);

  const drop = useClaimableDrop(publicKey);

  /** The link's key signs the contract call directly; the visitor's wallet only supplies the recipient. */
  const claim = async (accountId: string, create = false) => {
    if (!secretKey || !drop.data) return;
    setClaiming(true);
    setClaimError(null);
    setClaimTxHash(null);
    const gas = create ? CREATE_ACCOUNT_GAS : drop.data.gas;
    const attached = `${gas / 1_000_000_000_000n} TGas attached`;
    try {
      if (create) {
        // The registrar creates exactly one level under the network's root.
        const suffix = network === 'mainnet' ? '.near' : '.testnet';
        if (!/^[a-z0-9]+([-_][a-z0-9]+)*$/.test(accountId.slice(0, -suffix.length)) || !accountId.endsWith(suffix)) {
          setClaimError({ message: `Use a name like alice${suffix}: lowercase letters, digits, - or _.`, detail: '' });
          return;
        }
        const taken = await provider
          .viewAccount({ accountId, blockQuery: { finality: 'final' } })
          .then(() => true, () => false);
        if (taken) {
          setClaimError({ message: `${accountId} already exists. Pick another name.`, detail: '' });
          return;
        }
      }
      const account = new Account(
        contracts.linkdrop.contractId,
        RpcUrls[network][0],
        secretKey as KeyPairString
      );
      const outcome = await account.callFunctionRaw({
        contractId: contracts.linkdrop.contractId,
        methodName: create
          ? 'create_account_and_claim'
          : contracts.linkdrop.provider === 'near-drop'
            ? 'claim_for'
            : 'claim',
        args: { account_id: accountId },
        gas,
      });
      setClaimTxHash(txHashOf(outcome) ?? null);
      // Two ways a claim "succeeds" without handing anything over: the gas did
      // not match the drop, or the contract returned false (already claimed).
      if (claimAborted(outcome) || claimReturnedFalse(outcome)) {
        setClaimError({
          message: 'The contract ran but did not hand over the drop. Nothing reached your account.',
          detail: attached,
        });
        return;
      }
      setClaimedInto(accountId);
      setCreatedAccount(create);
    } catch (error) {
      // A failed transaction still has a hash — show it so the receipt is
      // readable in the explorer. The RPC spells out the allowance and the real
      // cost; describeError() truncates it, so keep the raw text too.
      setClaimTxHash(txHashOfError(error));
      setClaimError({
        message: describeError(error).message,
        detail: `${attached} · ${rawError(error)}`.slice(0, 600),
      });
    } finally {
      setClaiming(false);
    }
  };

  return (
    <main className="wrap claim-page">
      <section className="card claim-card">
        <p className="claim-eyebrow">You received a drop</p>

        {!secretKey && <p className="hint">This link is missing its key. Ask the sender for the full URL.</p>}

        {secretKey && !publicKey && (
          <p className="hint error">That key is not valid. The link may have been truncated when it was shared.</p>
        )}

        {publicKey && drop.isLoading && <p className="hint" role="status">Reading the drop…</p>}

        {publicKey && drop.isError && !drop.data && (
          <p className="hint error">
            No drop found for this link on {network}. It may already have been claimed
            {network === 'mainnet' ? ', or it belongs to testnet — switch networks above.' : '.'}
          </p>
        )}

        {drop.data && (
          <>
            <DropPreview preview={drop.data} />

            {drop.data.gas === 0n && (
              <p className="hint error" role="alert">
                This link cannot pay for its own claim: the drop needs{' '}
                {drop.data.requiredGas / 1_000_000_000_000n} TGas of prepaid gas and the key&apos;s
                allowance does not cover it. Claiming anyway hands over nothing and spends what is
                left, so it stays disabled. Ask whoever sent the link to re-create the drop.
              </p>
            )}

            {claimedInto ? (
              <div className="result-summary">
                <p>✓ Claimed into {claimedInto}.</p>
                {createdAccount && (
                  <p className="hint" role="alert">
                    The account&apos;s only full-access key is this link&apos;s secret key. Save it
                    now and import it into a wallet (&quot;import with private key&quot;) — whoever
                    has this link controls the account.
                    <code>{secretKey}</code>
                  </p>
                )}
                {claimTxHash && (
                  <p>
                    Transaction: <TxLink network={network} hash={claimTxHash}>{claimTxHash}</TxLink>
                  </p>
                )}
              </div>
            ) : signedAccountId ? (
              <div className="claim-actions">
                <button className="btn btn-block" onClick={() => claim(signedAccountId)} disabled={claiming || drop.data.gas === 0n}>
                  {claiming ? 'Claiming…' : `Claim into ${signedAccountId}`}
                </button>
              </div>
            ) : (
              <div className="claim-actions">
                <button className="btn btn-block" onClick={() => signIn()}>Connect wallet to claim</button>
                {contracts.linkdrop.provider === 'near-drop' && (
                  <form
                    className="claim-new-account"
                    onSubmit={(event) => {
                      event.preventDefault();
                      claim(newAccount.trim().toLowerCase(), true);
                    }}
                  >
                    <p className="claim-divider">or create a new account</p>
                    <label className="wizard-field" htmlFor="new-account">
                      <span className="sr-only">New account name</span>
                      <input
                        id="new-account"
                        value={newAccount}
                        onChange={(event) => setNewAccount(event.target.value)}
                        placeholder={network === 'mainnet' ? 'alice.near' : 'alice.testnet'}
                        autoComplete="off"
                        required
                      />
                    </label>
                    <button className="btn btn-ghost btn-block" type="submit" disabled={claiming}>
                      {claiming ? 'Creating…' : 'Create account & claim'}
                    </button>
                  </form>
                )}
              </div>
            )}

            {!claimedInto && claimError && (
              <div className="hint error" role="alert">
                <p>{claimError.message}</p>
                {claimTxHash && (
                  <p>
                    Transaction: <TxLink network={network} hash={claimTxHash}>{claimTxHash}</TxLink>
                  </p>
                )}
                {claimError.detail && <code>{claimError.detail}</code>}
              </div>
            )}

            <p className="claim-alt">
              {/* ponytail: one deep link — Meteor is the only wallet with a documented linkdrop URL */}
              {contracts.linkdrop.provider === 'keypom' && (
                <a
                  className="btn btn-ghost"
                  href={`https://wallet.meteorwallet.app/linkdrop/${contracts.linkdrop.contractId}/${secretKey}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in Meteor Wallet
                </a>
              )}
              <a className="claim-explorer" href={NetworkConfig[network].explorerBase} target="_blank" rel="noopener noreferrer">
                {network === 'mainnet' ? 'NearBlocks ↗' : 'NearBlocks testnet ↗'}
              </a>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
