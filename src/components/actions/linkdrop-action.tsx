'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNearWallet } from 'near-connect-hooks';
import { KeyPair, yoctoToNear } from 'near-api-js';
import { useNetwork } from '@/components/app-providers';
import { AssetOption, AssetPicker } from '@/components/asset-picker';
import { ClaimLinks } from '@/components/claim-links';
import { HeldToken, nativeNear, OwnedNft, useHoldings, useOwnedNfts } from '@/hooks/use-holdings';
import {
  ActionContracts,
  fromUnits,
  KEYPOM_FEE_PER_LINK,
  KEYPOM_NFT_DEPOSIT_PER_USE,
  linkdropDeposit,
  toUnits,
} from '@/lib/actions/contracts';
import { claimUrl, saveDropKeys, saveDropName } from '@/lib/actions/linkdrop-keys';
import { FT_STORAGE_DEPOSIT, GAS, GAS_300, isAmount } from '@/lib/near';
import { Field, useForm } from './form-fields';
import { WizardShell } from './wizard-shell';

const MAX_LINKS = 30;
// An NFT option carries its token id in the same picker value: "nft:<token_id>".
const NFT_PREFIX = 'nft:';
const initial = { dropName: '', asset: 'near', amount: '', quantity: '1' };

type Plan = {
  asset: 'near' | 'ft' | 'nft';
  links: number;
  /** What each link pays out: NEAR, token units, or the claimer's storage for an NFT. */
  perLink: bigint;
  /** NEAR attached to create_drop. */
  nearDeposit: bigint;
  /** Tokens sent to Keypom in the follow-up ft_transfer_call. */
  tokenTotal: bigint;
};

/** Total the user pays, computed locally — Keypom has no quote method. */
function planDrop(token: HeldToken, nft: OwnedNft | undefined, amount: string, quantity: string): Plan | null {
  if (nft)
    return {
      asset: 'nft',
      links: 1,
      perLink: KEYPOM_NFT_DEPOSIT_PER_USE,
      // The per-use deposit is paid out of the attached deposit, so attach both.
      nearDeposit: KEYPOM_FEE_PER_LINK + KEYPOM_NFT_DEPOSIT_PER_USE,
      tokenTotal: 0n,
    };
  // Runs on every render: "1.5" links or "1e3" tokens must not reach BigInt/toUnits.
  const links = Number(quantity);
  if (!Number.isInteger(links) || links < 1) return null;
  const isNear = token.contractId === 'near';
  const perLink = isAmount(amount, token.decimals) ? toUnits(amount, token.decimals) : 0n;
  return {
    asset: isNear ? 'near' : 'ft',
    links,
    perLink,
    nearDeposit: linkdropDeposit(links, isNear ? perLink : 0n, !isNear),
    tokenTotal: isNear ? 0n : perLink * BigInt(links),
  };
}

const newKeys = (count: number) =>
  Array.from({ length: count }, () => {
    const pair = KeyPair.fromRandom('ed25519');
    return { private: pair.toString(), public: pair.getPublicKey().toString() };
  });

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const nftName = (nft: OwnedNft) => nft.metadata?.title || nft.token_id;

export function LinkdropAction() {
  const { network } = useNetwork();
  const { signedAccountId: owner, signAndSendTransactions, viewFunction } = useNearWallet();
  const form = useForm(initial);
  const { fields, bind } = form;
  const [claimLinks, setClaimLinks] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const contracts = ActionContracts[network];
  const usesNearDrop = contracts.linkdrop.provider === 'near-drop';
  // near-drop quotes its exact deposit at review; submit reuses the quoted keys.
  const quoted = useRef<{ keys: { private: string; public: string }[]; deposit: bigint } | null>(null);

  const holdings = useHoldings(owner);
  const ownedNfts = useOwnedNfts(owner);
  // ponytail: NEAR is always selectable — a slow or rate-limited holdings fetch
  // must never leave the asset picker empty and the total uncomputable
  const tokens = holdings.data?.length ? holdings.data : [nativeNear(0n)];
  const token = tokens.find((t) => t.contractId === fields.asset) ?? tokens[0];
  const nft = fields.asset.startsWith(NFT_PREFIX)
    ? ownedNfts.data?.find((n) => n.token_id === fields.asset.slice(NFT_PREFIX.length))
    : undefined;
  const plan = planDrop(token, nft, fields.amount, fields.quantity);

  const assetOptions: AssetOption[] = [
    ...tokens.map((t) => ({
      value: t.contractId,
      label: t.symbol,
      detail: t.balance > 0n ? `${fromUnits(t.balance, t.decimals)} available` : undefined,
      icon: t.icon,
      group: 'Tokens' as const,
    })),
    ...(ownedNfts.data ?? []).map((n) => ({
      value: NFT_PREFIX + n.token_id,
      label: nftName(n),
      icon: n.metadata?.media,
      group: 'NFTs' as const,
    })),
  ];

  /** One cost string for the form, the review sheet and the receipt. */
  const near = (amount: bigint) => `${yoctoToNear(amount, 4)} Ⓝ`;
  const payout = plan?.asset === 'near' ? plan.perLink * BigInt(plan.links) : 0n;
  const costOf = (plan: Plan, nearDeposit: bigint) =>
    plan.asset === 'nft'
      ? `1 NFT + ${near(nearDeposit)}`
      : plan.asset === 'near'
        ? near(nearDeposit)
        : `${fromUnits(plan.tokenTotal, token.decimals)} ${token.symbol} + ${near(nearDeposit)}`;
  const serviceFee = plan && !usesNearDrop ? near(linkdropDeposit(plan.links, 0n, true)) : '';
  const cost = plan && !usesNearDrop ? costOf(plan, plan.nearDeposit) : '';

  const review = async () => {
    const found: Partial<typeof initial> = {};
    if (!fields.dropName.trim()) found.dropName = 'Required.';
    // An NFT drop funds exactly one link with one token — nothing else to check.
    if (!nft) {
      const links = Number(fields.quantity);
      if (!/^\d+$/.test(fields.quantity) || links < 1 || links > MAX_LINKS)
        found.quantity = `A whole number from 1 to ${MAX_LINKS}.`;
      if (!isAmount(fields.amount, token.decimals) || toUnits(fields.amount, token.decimals) === 0n)
        found.amount = `A positive amount with at most ${token.decimals} decimals.`;
      else if (token.balance > 0n && toUnits(fields.amount, token.decimals) * BigInt(Math.max(links, 1)) > token.balance)
        found.amount = `You hold ${fromUnits(token.balance, token.decimals)} ${token.symbol}.`;
    }
    if (!form.check(found) || !plan) return null;
    const createMethod = usesNearDrop
      ? `create_${plan.asset}_drop`
      : contracts.linkdrop.createMethod;

    let fee = serviceFee;
    let total = cost;
    if (usesNearDrop) {
      const keys = newKeys(plan.links);
      // get_<asset>_drop_cost runs the same formula create_<asset>_drop charges.
      const deposit = BigInt(
        (await viewFunction({
          contractId: contracts.linkdrop.contractId,
          method: `get_${plan.asset}_drop_cost`,
          args: { funder: owner, ...nearDropArgs(plan, keys) },
        })) as string
      );
      quoted.current = { keys, deposit };
      fee = near(deposit - payout);
      total = costOf(plan, deposit);
    }

    return {
      summary: nft
        ? `Fund one claim link with "${nftName(nft)}".`
        : `Fund ${plural(plan.links, 'claim link')} for "${fields.dropName}".`,
      contract: contracts.linkdrop.contractId,
      method: createMethod,
      image: nft?.metadata?.media ? { src: nft.metadata.media, alt: nft.metadata.title ?? 'NFT' } : undefined,
      rows: [
        { label: 'Campaign', value: fields.dropName },
        { label: 'Asset', value: nft ? `${nftName(nft)} (${contracts.nft.contractId})` : token.symbol },
        { label: 'Per link', value: nft ? 'One NFT' : `${fields.amount} ${token.symbol}` },
        { label: 'Links', value: String(plan.links) },
      ],
      send: total,
      receive: plural(plan.links, 'claim link'),
      fee: `${fee} contract funding`,
      total,
      notices: [
        'Claim links are stored in this browser only. Clearing site data destroys any unclaimed link permanently — download them after funding.',
        ...(nft
          ? [usesNearDrop
              ? 'The NFT stays in your account but is approved for transfer to whoever claims the link.'
              : 'The NFT is transferred to the Keypom contract when you sign, and belongs to whoever opens the link.']
          : []),
        'Unclaimed funds cannot be reclaimed from this interface yet.',
        // Measured 2026-09-22 — see linkdrop-keys.ts for the arithmetic.
        `${usesNearDrop ? 'The drop contract' : 'Keypom'} funds each link with a fixed gas allowance. Network gas-price changes can affect whether that allowance is enough to claim.`,
      ],
    };
  };

  const submit = async () => {
    if (!plan) throw new Error('Nothing to fund.');
    let dropId = Date.now().toString();
    let stored = false;
    if (usesNearDrop && !quoted.current) throw new Error('Review the drop again to get a fresh quote.');
    const keys = quoted.current?.keys ?? newKeys(plan.links);

    const call = (receiverId: string, methodName: string, args: object, deposit: bigint) => ({
      receiverId,
      signerId: owner,
      actions: [
        {
          type: 'FunctionCall',
          params: { methodName, args, gas: GAS_300.toString(), deposit: deposit.toString() },
        },
      ],
    });

    if (usesNearDrop) {
      const { deposit } = quoted.current!;
      quoted.current = null;
      const [outcome] = await signAndSendTransactions({
        transactions: [
          call(contracts.linkdrop.contractId, `create_${plan.asset}_drop`, nearDropArgs(plan, keys), deposit),
        ],
      });
      const encoded = (outcome.status as { SuccessValue?: string }).SuccessValue;
      if (!encoded) throw new Error('The contract did not return a drop ID.');
      dropId = String(JSON.parse(atob(encoded)));
      // Persist before the second FT/NFT wallet request: the access keys already
      // exist on-chain even if the asset-funding transaction is later rejected.
      stored = saveDropKeys(network, dropId, keys);
      saveDropName(network, dropId, fields.dropName);

      if (nft) {
        await signAndSendTransactions({
          transactions: [call(contracts.nft.contractId, 'nft_approve', {
            token_id: nft.token_id,
            account_id: contracts.linkdrop.contractId,
            msg: dropId,
          }, 10n ** 22n)],
        });
      } else if (plan.asset === 'ft') {
        const transfer = call(token.contractId, 'ft_transfer_call', {
          receiver_id: contracts.linkdrop.contractId,
          amount: plan.tokenTotal.toString(),
          msg: dropId,
        }, 1n);
        // An unregistered drop contract makes ft_transfer_call fail, leaving the
        // drop created but unfunded — register it in the same transaction first.
        const registered = await viewFunction({
          contractId: token.contractId,
          method: 'storage_balance_of',
          args: { account_id: contracts.linkdrop.contractId },
        }).catch(() => null);
        if (!registered) {
          // A transaction carries at most 300 TGas in total.
          transfer.actions[0].params.gas = (GAS_300 - GAS).toString();
          transfer.actions.unshift({
            type: 'FunctionCall',
            params: {
              methodName: 'storage_deposit',
              args: { account_id: contracts.linkdrop.contractId, registration_only: true },
              gas: GAS.toString(),
              deposit: FT_STORAGE_DEPOSIT.toString(),
            },
          });
        }
        await signAndSendTransactions({ transactions: [transfer] });
      }
    } else {
      const transactions = [
      call(
        contracts.linkdrop.contractId,
        contracts.linkdrop.createMethod,
        {
          drop_id: dropId,
          // An NFT link still funds the claimer's storage; a NEAR link pays out
          // its amount; an FT link pays out nothing in NEAR.
          deposit_per_use: plan.asset === 'ft' ? '0' : plan.perLink.toString(),
          metadata: JSON.stringify({ dropName: fields.dropName }),
          public_keys: keys.map((key) => key.public),
          ft:
            plan.asset === 'ft'
              ? { sender_id: owner, contract_id: token.contractId, balance_per_use: plan.perLink.toString() }
              : undefined,
          nft: nft ? { sender_id: owner, contract_id: contracts.nft.contractId } : undefined,
        },
        plan.nearDeposit
      ),
    ];
      // The drop is funded by sending the asset to Keypom with the drop id as msg.
      if (nft)
        transactions.push(
          call(contracts.nft.contractId, 'nft_transfer_call', {
            receiver_id: contracts.linkdrop.contractId,
            token_id: nft.token_id,
            msg: dropId,
          }, 1n)
        );
      if (plan.asset === 'ft')
        transactions.push(
          call(token.contractId, 'ft_transfer_call', {
            receiver_id: contracts.linkdrop.contractId,
            amount: plan.tokenTotal.toString(),
            msg: dropId,
          }, 1n)
        );

      await signAndSendTransactions({ transactions });
    }

    if (!stored) stored = saveDropKeys(network, dropId, keys);
    setClaimLinks(keys.map((key) => claimUrl(key.private)));
    queryClient.invalidateQueries({ queryKey: ['drops', network, owner] });
    form.reset();
    return {
      summary: nft
        ? `Funded a claim link for "${nftName(nft)}"`
        : `Funded ${plural(plan.links, 'claim link')} for "${fields.dropName}"`,
      next: stored
        ? usesNearDrop
          ? 'The links are saved in this browser. Download a copy before leaving this page.'
          : 'The links are listed under "Your drops" until they are claimed — this browser is the only place they exist.'
        : 'Storage is blocked in this browser, so these links exist nowhere else. Download them now.',
    };
  };

  /** Shared by create_<asset>_drop and get_<asset>_drop_cost (which also takes `funder`). */
  const nearDropArgs = (plan: Plan, keys: { public: string }[]) =>
    plan.asset === 'near'
      ? { public_keys: keys.map((key) => key.public), amount_per_drop: plan.perLink.toString() }
      : plan.asset === 'ft'
        ? {
            public_keys: keys.map((key) => key.public),
            ft_contract: token.contractId,
            amount_per_drop: plan.perLink.toString(),
          }
        : { public_key: keys[0].public, nft_contract: contracts.nft.contractId };

  return (
    <WizardShell
      kind="linkdrop"
      title="Create Linkdrop"
      description={`Fund claim links through ${usesNearDrop ? 'Near Drop' : 'Keypom'}. Secret keys stay in this browser.`}
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
      </label>

      {nft ? (
        <div className="wizard-field wizard-field-wide drop-nft-preview">
          {nft.metadata?.media && <img src={nft.metadata.media} alt="" />}
          <p className="hint">
            One link, one NFT. {usesNearDrop
              ? 'The contract receives approval to transfer it when the link is claimed.'
              : 'The token leaves your account when you sign, and comes back only if you delete the drop.'}
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

      {plan && (nft || fields.amount) && (
        <p className="wizard-total">
          {plural(plan.links, 'link')} × {nft ? nftName(nft) : `${fields.amount} ${token.symbol}`} +{' '}
          {usesNearDrop ? (
            'contract funding, quoted by the contract at review'
          ) : (
            <>
              {serviceFee} contract funding = <strong>{cost}</strong>
            </>
          )}
        </p>
      )}
    </WizardShell>
  );
}
