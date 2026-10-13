'use client';

import { useState } from 'react';
import { useNearWallet } from 'near-connect-hooks';
import { useQueryClient } from '@tanstack/react-query';
import { yoctoToNear } from 'near-api-js';
import { useNetwork } from '@/components/app-providers';
import { ActionContracts, FtCreateArgs, ftTotalSupply, normalizeSymbol } from '@/lib/actions/contracts';
import { GAS_300, txHashOf } from '@/lib/near';
import { loadHoldings, saveHoldings, type HeldToken } from '@/lib/holdings';
import { Field, ImageField, useForm } from './form-fields';
import { WizardShell } from './wizard-shell';

const initial = { name: '', symbol: '', decimals: '6', supply: '', icon: '' };

export function FtAction() {
  const { network } = useNetwork();
  const { signedAccountId: owner, viewFunction, callFunction } = useNearWallet();
  const form = useForm(initial);
  const { fields, bind } = form;
  const [deposit, setDeposit] = useState(0n);
  const factory = ActionContracts[network].ft;
  const queryClient = useQueryClient();
  const symbol = fields.symbol.toUpperCase();
  const tokenAccount = fields.symbol ? `${normalizeSymbol(fields.symbol)}.${factory.contractId}` : '';

  const args = (): FtCreateArgs => ({
    owner_id: owner,
    total_supply: ftTotalSupply(fields.supply, Number(fields.decimals)).toString(),
    metadata: { spec: 'ft-1.0.0', name: fields.name, symbol, icon: fields.icon, decimals: Number(fields.decimals) },
  });

  const review = async () => {
    const found: Partial<typeof initial> = {};
    if (!fields.name.trim()) found.name = 'Required.';
    // It becomes an account name: no leading, trailing or doubled hyphen.
    if (!/^[A-Za-z](-?[A-Za-z0-9]){1,11}$/.test(fields.symbol) || fields.symbol.length > 12)
      found.symbol = '2–12 letters, digits or single hyphens, starting with a letter.';
    if (!/^\d+$/.test(fields.decimals) || Number(fields.decimals) > 24)
      found.decimals = 'A whole number from 0 to 24.';
    if (!/^[1-9]\d*$/.test(fields.supply)) found.supply = 'A positive whole number.';
    else if (!found.decimals && ftTotalSupply(fields.supply, Number(fields.decimals)) >= 2n ** 128n)
      found.supply = 'Too large: supply × 10^decimals must fit in a u128.';
    if (!fields.icon) found.icon = 'An icon is required by the factory.';
    if (!form.check(found)) return null;

    // The account name must be free before we quote anything.
    const taken = await viewFunction({ contractId: tokenAccount, method: 'ft_metadata' }).then(
      () => true,
      () => false
    );
    if (taken) {
      form.check({ symbol: `${tokenAccount} already exists. Pick another symbol.` });
      return null;
    }

    const required = BigInt(
      (await viewFunction({
        contractId: factory.contractId,
        method: 'get_required',
        args: { args: args() },
      })) as string
    );
    setDeposit(required);
    return {
      summary: `Create the token contract ${tokenAccount}, owned by ${owner}.`,
      contract: factory.contractId,
      method: 'create_token',
      image: { src: fields.icon, alt: `Icon for ${symbol}` },
      rows: [
        { label: 'Token', value: `${fields.name} (${symbol})` },
        { label: 'New account', value: tokenAccount },
        { label: 'Decimals', value: fields.decimals },
        { label: 'Initial supply', value: `${Number(fields.supply).toLocaleString()} ${symbol}` },
      ],
      send: 'Nothing — the deposit below covers storage',
      receive: `The full supply, in ${owner}`,
      fee: `${yoctoToNear(required, 5)} Ⓝ storage deposit`,
      total: `${yoctoToNear(required, 5)} Ⓝ`,
    };
  };

  const submit = async () => {
    const outcome = await callFunction({
      contractId: factory.contractId,
      method: 'create_token',
      args: { args: args() },
      gas: GAS_300.toString(),
      deposit: deposit.toString(),
    });
    // The factory gives the owner the full supply. Remember the contract now,
    // without waiting for either indexer to discover its first event.
    const created: HeldToken = {
      contractId: tokenAccount, symbol, decimals: Number(fields.decimals),
      balance: ftTotalSupply(fields.supply, Number(fields.decimals)), icon: fields.icon,
    };
    const key = ['holdings', network, owner];
    await queryClient.cancelQueries({ queryKey: key });
    const previous = queryClient.getQueryData<HeldToken[]>(key) ?? loadHoldings(network, owner) ?? [];
    const tokens = [...previous.filter((token) => token.contractId !== tokenAccount), created];
    saveHoldings(network, owner, tokens);
    queryClient.setQueryData(key, tokens);
    queryClient.invalidateQueries({ queryKey: ['ft-storage', network, owner] });
    form.reset();
    return {
      summary: `Created ${symbol} at ${tokenAccount}`,
      txHash: txHashOf(outcome),
      next: 'The token appears in your wallet once the transaction settles.',
    };
  };

  return (
    <WizardShell
      title="Mint a Fungible Token"
      description="Deploy a NEP-141 fungible token through the token factory."
      dirty={form.dirty}
      review={review}
      submit={submit}
    >
      <Field {...bind('name')} label="Token name" required placeholder="e.g. Demo Token" />
      <Field
        {...bind('symbol')}
        onChange={(v) => form.set('symbol', v.toUpperCase())}
        label="Symbol"
        required
        placeholder="e.g. DEMO"
        hint={tokenAccount ? `Creates ${tokenAccount}` : 'The contract account is derived from this.'}
      />
      <Field {...bind('decimals')} label="Decimals" required type="number" min="0" max="24" />
      <Field
        {...bind('supply')}
        label="Initial supply"
        required
        type="number"
        placeholder="e.g. 1000000"
        hint="Whole tokens. Decimals are applied for you."
      />
      <ImageField
        {...bind('icon')}
        label="Token icon"
        maxBytes={10 * 1024}
        resizeTo={128}
        hint="PNG, JPEG, GIF or SVG · Large icons are resized and compressed to fit within 10 KB on chain."
      />
    </WizardShell>
  );
}
