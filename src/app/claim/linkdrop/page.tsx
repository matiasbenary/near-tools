'use client';

import { useEffect, useMemo, useState } from 'react';
import { useNearWallet } from 'near-connect-hooks';
import { useQuery } from '@tanstack/react-query';
import { Account, KeyPair, type KeyPairString, yoctoToNear } from 'near-api-js';
import { useNetwork } from '@/components/app-providers';
import { ActionContracts, fromUnits } from '@/lib/actions/contracts';
import { canClaim, CLAIM_GAS, claimSucceeded, dropReady, type OnChainDrop } from '@/lib/actions/linkdrop';
import { describeError, rawError, UserFacingError } from '@/lib/errors';
import { txHashOf } from '@/lib/near';
import { RpcUrls } from '@/config';
import { TxLink } from '@/components/result-sheet';

/** near-api-js throws a TransactionExecutionError, which carries the hash. */
const txHashOfError = (error: unknown) => {
  const hash = (error as { txHash?: string })?.txHash;
  return hash || null;
};

type Preview = { gas: bigint; ready: boolean } & (
  | { kind: 'ft'; symbol: string; amount: string; icon?: string; contractId: string }
  | { kind: 'nft'; title: string; media?: string; contractId: string; tokenId: string }
  | { kind: 'near'; amount: string }
);

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
      const [dropId, accessKey, price] = await Promise.all([
        viewFunction({ contractId: contracts.linkdrop.contractId,
          method: 'get_drop_id_by_key', args: { public_key: publicKey } }) as Promise<number>,
        provider.viewAccessKey({ accountId: contracts.linkdrop.contractId,
          publicKey: publicKey!, finalityQuery: { finality: 'final' } }),
        provider.viewGasPrice(),
      ]);
      const drop = await viewFunction({ contractId: contracts.linkdrop.contractId,
        method: 'get_drop_by_id', args: { drop_id: dropId } }) as OnChainDrop;
      if (accessKey.permission === 'FullAccess') throw new UserFacingError('Invalid claim key.');
      const permission = accessKey.permission.FunctionCall;
      if (permission.receiver_id !== contracts.linkdrop.contractId || !permission.method_names.includes('claim_for'))
        throw new UserFacingError('Invalid claim key.');
      const gasPrice = BigInt(price.gas_price);
      const budget = {
        gas: canClaim(permission.allowance, gasPrice, CLAIM_GAS) ? CLAIM_GAS : 0n,
        ready: dropReady(drop),
      };
      if ('FT' in drop) {
        const metadata = await viewFunction({ contractId: drop.FT.ft_contract, method: 'ft_metadata' }) as
          { symbol?: string; decimals?: number; icon?: string };
        return { ...budget, kind: 'ft', symbol: metadata.symbol ?? drop.FT.ft_contract,
          amount: fromUnits(BigInt(drop.FT.amount), metadata.decimals ?? 24),
          icon: metadata.icon, contractId: drop.FT.ft_contract };
      }
      if ('NFT' in drop) {
        const token = drop.NFT.token_id ? await viewFunction({ contractId: drop.NFT.nft_contract,
          method: 'nft_token', args: { token_id: drop.NFT.token_id } }).catch(() => null) as
          { metadata?: { title?: string; media?: string } } | null : null;
        return { ...budget, kind: 'nft', title: token?.metadata?.title || drop.NFT.token_id || 'NFT',
          media: token?.metadata?.media, contractId: drop.NFT.nft_contract, tokenId: drop.NFT.token_id };
      }
      return { ...budget, kind: 'near', amount: yoctoToNear(BigInt(drop.NEAR.amount), 4) };
    },
  });
}

export default function ClaimPage() {
  const { network, setNetwork } = useNetwork();
  const { signedAccountId, signIn } = useNearWallet();
  const contracts = ActionContracts[network];
  const [secretKey, setSecretKey] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<{ message: string; detail: string } | null>(null);
  const [claimedInto, setClaimedInto] = useState<string | null>(null);
  const [claimConsumed, setClaimConsumed] = useState(false);
  const [claimTxHash, setClaimTxHash] = useState<string | null>(null);

  // ponytail: window.location over useSearchParams — the latter needs a Suspense
  // boundary under `output: export`. Read the key and network from the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkNetwork = params.get('network');
    if (linkNetwork === 'mainnet' || linkNetwork === 'testnet') setNetwork(linkNetwork);
    setSecretKey(params.get('id'));
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
  const claim = async (accountId: string) => {
    if (!secretKey || !drop.data) return;
    setClaiming(true);
    setClaimError(null);
    setClaimTxHash(null);
    const gas = drop.data.gas;
    const attached = `${gas / 1_000_000_000_000n} TGas attached`;
    try {
      if (!drop.data.ready) throw new UserFacingError('This drop is awaiting funding. Ask the sender to finish funding it.');
      if (gas === 0n) throw new UserFacingError('This link has too little gas allowance for this claim.', 'link-underfunded');
      const account = new Account(
        contracts.linkdrop.contractId,
        RpcUrls[network][0],
        secretKey as KeyPairString
      );
      const outcome = await account.callFunctionRaw({
        contractId: contracts.linkdrop.contractId,
        methodName: 'claim_for',
        args: { account_id: accountId },
        gas,
      });
      setClaimTxHash(txHashOf(outcome) ?? null);
      // The contract reports delivery with its final boolean return value.
      if (!claimSucceeded(outcome)) {
        setClaimConsumed(true);
        setClaimError({
          message: 'The claim did not complete. The link was consumed and unused assets are refunded to the sender. Check the transaction below.',
          detail: attached,
        });
        return;
      }
      setClaimedInto(accountId);
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

            {!drop.data.ready && (
              <p className="hint error" role="alert">This drop is awaiting asset funding. Ask the sender to finish funding it before claiming.</p>
            )}
            {drop.data.gas === 0n && (
              <p className="hint error" role="alert">This link has too little remaining gas allowance to claim. Ask the sender for a replacement.</p>
            )}

            {claimedInto ? (
              <div className="result-summary">
                <p>✓ Claimed into {claimedInto}.</p>
                {claimTxHash && (
                  <p>
                    Transaction: <TxLink network={network} hash={claimTxHash}>{claimTxHash}</TxLink>
                  </p>
                )}
              </div>
            ) : signedAccountId ? (
              <div className="claim-actions">
                <button className="btn btn-block" onClick={() => claim(signedAccountId)} disabled={claiming || claimConsumed || !drop.data.ready || drop.data.gas === 0n}>
                  {claiming ? 'Claiming…' : `Claim into ${signedAccountId}`}
                </button>
              </div>
            ) : (
              <div className="claim-actions">
                <button className="btn btn-block" onClick={() => signIn()}>Connect wallet to claim</button>

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

          </>
        )}
      </section>
    </main>
  );
}
