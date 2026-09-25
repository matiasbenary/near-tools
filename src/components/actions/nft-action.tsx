'use client';

import { useNearWallet } from 'near-connect-hooks';
import { yoctoToNear } from 'near-api-js';
import { useNetwork } from '@/components/app-providers';
import { ActionContracts, nftMintDeposit } from '@/lib/actions/contracts';
import { GAS_300, txHashOf } from '@/lib/near';
import { Field, ImageField, useForm } from './form-fields';
import { WizardShell } from './wizard-shell';

const IPFS = 'https://ipfs.near.social';
const initial = { title: '', description: '', media: '' };

export function NftAction() {
  const { network } = useNetwork();
  const { signedAccountId: owner, callFunction } = useNearWallet();
  const form = useForm(initial);
  const { fields, bind } = form;
  const collection = ActionContracts[network].nft;

  const mintArgs = (media: string) => ({
    receiver_id: owner,
    token_id: crypto.randomUUID(),
    token_metadata: { media, title: fields.title, description: fields.description },
  });

  const review = async () => {
    const found: Partial<typeof initial> = {};
    if (!fields.title.trim()) found.title = 'Required.';
    if (!fields.description.trim()) found.description = 'Required.';
    if (!fields.media) found.media = 'An image is required.';
    if (!form.check(found)) return null;

    // The CID is unknown until upload, so estimate with one of the same length.
    const estimate = nftMintDeposit(mintArgs(`${IPFS}/ipfs/${'x'.repeat(46)}`));
    return {
      summary: `Mint "${fields.title}" into ${collection.contractId}, owned by ${owner}.`,
      contract: collection.contractId,
      method: collection.mintMethod,
      image: { src: fields.media, alt: fields.title },
      rows: [
        { label: 'Title', value: fields.title },
        { label: 'Description', value: fields.description },
        { label: 'Owner', value: owner },
      ],
      send: 'Nothing — the deposit below covers storage',
      receive: 'One NFT in your wallet',
      fee: `≈ ${yoctoToNear(estimate, 5)} Ⓝ storage deposit`,
      total: `≈ ${yoctoToNear(estimate, 5)} Ⓝ`,
      notices: ['Your image is uploaded to IPFS when you confirm, not before.'],
    };
  };

  const submit = async () => {
    const upload = await fetch(`${IPFS}/add`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: await (await fetch(fields.media)).blob(),
    });
    const { cid } = (await upload.json()) as { cid: string };
    const args = mintArgs(`${IPFS}/ipfs/${cid}`);
    const outcome = await callFunction({
      contractId: collection.contractId,
      method: collection.mintMethod,
      args,
      gas: GAS_300.toString(),
      deposit: nftMintDeposit(args).toString(),
    });
    form.reset();
    return { summary: `Minted "${fields.title}" in ${collection.contractId}`, txHash: txHashOf(outcome) };
  };

  return (
    <WizardShell
      kind="nft"
      title="Create NFT"
      description="Mint a token into the shared NEP-171 collection. Your wallet owns it."
      dirty={form.dirty}
      review={review}
      submit={submit}
    >
      <Field {...bind('title')} label="Title" required />
      <Field {...bind('description')} label="Description" required type="textarea" />
      <ImageField
        {...bind('media')}
        label="Image"
        maxBytes={3 * 1024 * 1024}
        hint="PNG, JPEG, GIF or SVG · max 3 MB · uploaded to IPFS when you confirm."
      />
    </WizardShell>
  );
}
