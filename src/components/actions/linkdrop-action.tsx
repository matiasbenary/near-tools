'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNearWallet } from 'near-connect-hooks';
import { KeyPair, yoctoToNear } from 'near-api-js';
import { useNetwork } from '@/components/app-providers';
import { AssetOption, AssetPicker } from '@/components/asset-picker';
import { ClaimLinks } from '@/components/claim-links';
import { nativeNear, OwnedNft, useHoldings, useOwnedNfts } from '@/hooks/use-holdings';
import { ActionContracts, fromUnits, toUnits } from '@/lib/actions/contracts';
import { createDropArgs, dropReady, type CreateDrop, type OnChainDrop } from '@/lib/actions/linkdrop';
import { claimUrl, saveDrop, type DropKey } from '@/lib/actions/linkdrop-keys';
import { UserFacingError } from '@/lib/errors';
import { GAS, GAS_300, isAmount } from '@/lib/near';
import { Field, useForm } from './form-fields';
import { WizardShell } from './wizard-shell';

const MAX_LINKS = 30;
const NFT_PREFIX = 'nft:';
const initial = { dropName: '', asset: 'near', amount: '', quantity: '1' };
const newKeys = (count: number): DropKey[] => Array.from({ length: count }, () => {
  const pair = KeyPair.fromRandom('ed25519');
  return { private: pair.toString(), public: pair.getPublicKey().toString() };
});
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const nftName = (nft: OwnedNft) => nft.metadata?.title || nft.token_id;
const near = (amount: bigint) => `${yoctoToNear(amount, 4)} Ⓝ`;

type Quote = { keys: DropKey[]; deposit: bigint; ftRegistration: bigint; args: { drop: CreateDrop }; fingerprint: string };

export function LinkdropAction() {
  const { network } = useNetwork();
  const { signedAccountId: owner, signAndSendTransactions, viewFunction } = useNearWallet();
  const form = useForm(initial);
  const { fields, bind } = form;
  const [claimLinks, setClaimLinks] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const contracts = ActionContracts[network];
  const scope = { network, contractId: contracts.linkdrop.contractId, accountId: owner ?? '' };
  const quoted = useRef<Quote | null>(null);
  const fingerprint = JSON.stringify([network, owner, fields]);

  const holdings = useHoldings(owner);
  const ownedNfts = useOwnedNfts(owner);
  const tokens = holdings.data?.length ? holdings.data : [nativeNear(0n)];
  const token = tokens.find((t) => t.contractId === fields.asset) ?? tokens[0];
  const nft = fields.asset.startsWith(NFT_PREFIX)
    ? ownedNfts.data?.find((n) => n.token_id === fields.asset.slice(NFT_PREFIX.length))
    : undefined;
  const asset = nft ? 'nft' : token.contractId === 'near' ? 'near' : 'ft';
  const links = nft ? 1 : Number(fields.quantity);
  const perLink = nft ? 0n : isAmount(fields.amount, token.decimals) ? toUnits(fields.amount, token.decimals) : 0n;
  const assetOptions: AssetOption[] = [
    ...tokens.map((t) => ({ value: t.contractId, label: t.symbol,
      detail: t.balance > 0n ? `${fromUnits(t.balance, t.decimals)} available` : undefined,
      icon: t.icon, group: 'Tokens' as const })),
    ...(ownedNfts.data ?? []).map((n) => ({ value: NFT_PREFIX + n.token_id,
      label: nftName(n), icon: n.metadata?.media, group: 'NFTs' as const })),
  ];

  const review = async () => {
    const found: Partial<typeof initial> = {};
    if (!fields.dropName.trim()) found.dropName = 'Required.';
    if (fields.asset.startsWith(NFT_PREFIX) && !nft) found.asset = 'Select an NFT you hold.';
    if (nft && new TextEncoder().encode(nft.token_id).length > 128) found.asset = 'This NFT token ID exceeds the contract’s 128-byte limit.';
    if (!nft) {
      if (!/^\d+$/.test(fields.quantity) || links < 1 || links > MAX_LINKS)
        found.quantity = `A whole number from 1 to ${MAX_LINKS}.`;
      if (!isAmount(fields.amount, token.decimals) || perLink === 0n)
        found.amount = `A positive amount with at most ${token.decimals} decimals.`;
      else if (token.balance > 0n && Number.isInteger(links) && perLink * BigInt(Math.max(links, 1)) > token.balance)
        found.amount = `You hold ${fromUnits(token.balance, token.decimals)} ${token.symbol}.`;
    }
    quoted.current = null;
    if (!form.check(found)) return null;
    const keys = newKeys(links);
    const args = createDropArgs(asset, keys.map((key) => key.public), perLink,
      nft ? contracts.nft.contractId : token.contractId);
    const deposit = BigInt(await viewFunction({ contractId: contracts.linkdrop.contractId,
      method: 'get_drop_cost', args: { funder: owner, ...args } }) as string);
    let ftRegistration = 0n;
    if (asset === 'ft') {
      const registered = await viewFunction({ contractId: token.contractId, method: 'storage_balance_of',
        args: { account_id: contracts.linkdrop.contractId } });
      if (!registered) {
        const bounds = await viewFunction({ contractId: token.contractId, method: 'storage_balance_bounds' }) as { min: string };
        ftRegistration = BigInt(bounds.min);
      }
    }
    quoted.current = { keys, deposit, ftRegistration, args, fingerprint };
    const payout = asset === 'near' ? perLink * BigInt(links) : 0n;
    const total = asset === 'near' ? near(deposit) : nft ? `1 NFT + ${near(deposit)}`
      : `${fromUnits(perLink * BigInt(links), token.decimals)} ${token.symbol} + ${near(deposit + ftRegistration)}`;
    return {
      summary: nft ? `Fund one claim link with "${nftName(nft)}".` : `Fund ${plural(links, 'claim link')} for "${fields.dropName}".`,
      contract: contracts.linkdrop.contractId,
      method: 'create_drop',
      image: nft?.metadata?.media ? { src: nft.metadata.media, alt: nft.metadata.title ?? 'NFT' } : undefined,
      rows: [
        { label: 'Campaign', value: fields.dropName },
        { label: 'Asset', value: nft ? `${nftName(nft)} (${contracts.nft.contractId})` : token.symbol },
        { label: 'Per link', value: nft ? 'One NFT' : `${fields.amount} ${token.symbol}` },
        { label: 'Links', value: String(links) },
      ],
      send: total, receive: plural(links, 'claim link'), fee: `${near(deposit - payout + ftRegistration)} contract funding and storage`, total,
      notices: [
        'Claim links and campaign names are saved only in this browser. Download the links after funding.',
        ...(nft ? ['The NFT stays in your account and is approved for transfer when claimed. Approval is a separate wallet transaction.'] : []),
        ...(asset === 'ft' ? ['Funding the tokens is a separate wallet transaction after creating the drop. New recipients must support the contract’s 0.00126 NEAR registration budget.'] : []),
        'Deleting a drop cancels its remaining links and refunds unused assets and budgets directly to your account.',
      ],
    };
  };

  const submit = async () => {
    const quote = quoted.current;
    if (!quote || quote.fingerprint !== fingerprint)
      throw new UserFacingError('Review the drop again to get a fresh quote.', 'rejected', true);
    const call = (receiverId: string, methodName: string, args: object, deposit: bigint) => ({
      receiverId, signerId: owner,
      actions: [{ type: 'FunctionCall' as const,
        params: { methodName, args, gas: GAS_300.toString(), deposit: deposit.toString() } }],
    });
    const [outcome] = await signAndSendTransactions({ transactions: [
      call(contracts.linkdrop.contractId, 'create_drop', quote.args, quote.deposit),
    ] });
    const encoded = (outcome.status as { SuccessValue?: string }).SuccessValue;
    if (!encoded) throw new UserFacingError('The contract did not return a drop ID.');
    const id: unknown = JSON.parse(atob(encoded));
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id > 0xffffffff)
      throw new UserFacingError('The contract returned an invalid drop ID.');
    const dropId = String(id);
    // Keep the keys before the asset funding request, which can be cancelled.
    const stored = saveDrop(scope, dropId, quote.keys, fields.dropName);
    setClaimLinks(quote.keys.map((key) => claimUrl(key.private, network)));
    queryClient.invalidateQueries({ queryKey: ['drops', network, owner] });
    quoted.current = null;
    if (nft) {
      await signAndSendTransactions({ transactions: [call(contracts.nft.contractId, 'nft_approve', {
        token_id: nft.token_id, account_id: contracts.linkdrop.contractId, msg: dropId,
      }, 10n ** 22n)] });
    } else if (asset === 'ft') {
      const transfer = call(token.contractId, 'ft_transfer_call', {
        receiver_id: contracts.linkdrop.contractId, amount: (perLink * BigInt(links)).toString(), msg: dropId,
      }, 1n);
      if (quote.ftRegistration > 0n) {
        transfer.actions[0].params.gas = (GAS_300 - GAS).toString();
        transfer.actions.unshift({ type: 'FunctionCall', params: { methodName: 'storage_deposit',
          args: { account_id: contracts.linkdrop.contractId, registration_only: true },
          gas: GAS.toString(), deposit: quote.ftRegistration.toString() } });
      }
      await signAndSendTransactions({ transactions: [transfer] });
    }
    if (asset !== 'near') {
      const funded = await viewFunction({ contractId: contracts.linkdrop.contractId,
        method: 'get_drop_by_id', args: { drop_id: id } }) as OnChainDrop;
      if (!dropReady(funded)) throw new UserFacingError(
        'The drop was created, but its asset funding did not complete. Its links are saved below. Delete the unfunded drop in “Your drops” to recover its budgets before trying again.'
      );
    }
    form.reset();
    return {
      summary: nft ? `Funded a claim link for "${nftName(nft)}"` : `Funded ${plural(links, 'claim link')} for "${fields.dropName}"`,
      next: stored ? 'The links are saved in this browser. Download a copy before leaving this page.'
        : 'Storage is blocked in this browser. Download the links now; this browser could not save them.',
    };
  };
  return (
    <WizardShell
      title="Create a Linkdrop"
      description="Fund NEAR, token, or NFT claim links through Near Drop."
      dirty={form.dirty}
      review={review}
      submit={submit}
      afterResult={<ClaimLinks links={claimLinks} download />}
    >
      <Field {...bind('dropName')} label="Campaign name" required placeholder="Community rewards" />
      <label className="wizard-field" htmlFor="asset">
        <span>Asset</span>
        <AssetPicker
          id="asset"
          options={assetOptions}
          value={fields.asset}
          onChange={(v) => form.set('asset', v)}
          placeholder="Search your assets"
        />
        <small>
          {holdings.isLoading || ownedNfts.isLoading
            ? 'Loading your tokens…'
            : 'Only tokens and NFTs you hold are listed.'}
        </small>
        {form.errors.asset && <small className="error" role="alert">{form.errors.asset}</small>}
      </label>

      {nft ? (
        <div className="wizard-field wizard-field-wide drop-nft-preview">
          {nft.metadata?.media && <img src={nft.metadata.media} alt="" />}
          <p className="hint">
            One link, one NFT. The contract receives approval to transfer it when the link is claimed.
          </p>
        </div>
      ) : (
        <>
          <Field {...bind('amount')} label={`${token.symbol} per link`} required type="number" />
          <Field
            {...bind('quantity')}
            label="Number of links"
            required
            type="number"
            min="1"
            max={String(MAX_LINKS)}
          />
        </>
      )}

      {Number.isInteger(links) && links > 0 && (nft || fields.amount) && (
        <p className="wizard-total">
          {plural(links, 'link')} × {nft ? nftName(nft) : `${fields.amount} ${token.symbol}`} +{' '}
          contract funding, quoted by the contract at review
        </p>
      )}
    </WizardShell>
  );
}
