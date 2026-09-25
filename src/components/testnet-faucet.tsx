'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  Account,
  JsonRpcProvider,
  KeyPairSigner,
  type KeyPairString,
} from 'near-api-js';
import { NEAR } from 'near-api-js/tokens';
import { describeError } from '@/lib/errors';

const faucetAccountUrl = 'https://helper.testnet.near.org/account';
const testnetRpcUrl = 'https://rpc.testnet.fastnear.com';

// Public development key used by the faucet implementation in the referenced NEAR docs commit.
const temporaryAccountKey =
  'ed25519:5mixhRL3GcXL9sXx9B4juv6cp3Js4Qo7qY9gWs8bzcQGeSbefXMkCJh5UpmwZYriitMjsppqV4W8zb5bREkYRxLh' as KeyPairString;

const isTestnetBeneficiary = (accountId: string) =>
  accountId === 'testnet' ||
  accountId.endsWith('.testnet') ||
  /^[a-f0-9]{64}$/.test(accountId) ||
  /^0x[a-f0-9]{40}$/.test(accountId);

async function fundTestnetAccount(beneficiary: string) {
  const temporaryAccount = `${beneficiary.slice(0, 32).replaceAll('.', '-')}-${Date.now()}.testnet`;
  const signer = KeyPairSigner.fromSecretKey(temporaryAccountKey);
  const publicKey = await signer.getPublicKey();
  const response = await fetch(faucetAccountUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      newAccountId: temporaryAccount,
      newAccountPublicKey: publicKey.toString(),
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(details || `Faucet account request failed (${response.status})`);
  }

  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const provider = new JsonRpcProvider({ url: testnetRpcUrl });
  const account = new Account(temporaryAccount, provider, signer);
  await account.transfer({ receiverId: beneficiary, amount: NEAR.toUnits('5') });
  await account.deleteAccount('testnet');
}

export function TestnetFaucet({ accountId }: { accountId: string }) {
  const [beneficiary, setBeneficiary] = useState(accountId);
  const [status, setStatus] = useState<'idle' | 'requesting' | 'success'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!beneficiary && accountId) setBeneficiary(accountId);
  }, [accountId, beneficiary]);

  const requestFunds = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = beneficiary.trim();
    if (!isTestnetBeneficiary(target)) {
      setError('Enter a .testnet account, implicit account, or 0x account.');
      return;
    }

    setStatus('requesting');
    setError('');
    try {
      await fundTestnetAccount(target);
      setStatus('success');
    } catch (requestError) {
      setError(describeError(requestError).message);
      setStatus('idle');
    }
  };

  return (
    <aside className="faucet-panel" aria-labelledby="faucet-title">
      <p className="wizard-kicker">Testnet utility</p>
      <h2 id="faucet-title">Get 5 test NEAR</h2>
      <p>The faucet creates a temporary account, funds this account, and removes the temporary account.</p>
      <form className="faucet-form" onSubmit={requestFunds}>
        <label className="wizard-field">
          <span>Testnet account</span>
          <input
            name="accountId"
            value={beneficiary}
            placeholder="account.testnet"
            required
            disabled={status === 'requesting'}
            onChange={(event) => {
              setBeneficiary(event.target.value);
              setError('');
              setStatus('idle');
            }}
          />
        </label>
        <button className="btn btn-block" disabled={status !== 'idle'} type="submit">
          {status === 'requesting'
            ? 'Requesting test NEAR...'
            : status === 'success'
              ? 'Account funded'
              : 'Request test NEAR'}
        </button>
        {error && <p className="hint error" role="alert">{error}</p>}
        {status === 'success' && (
          <p className="hint ok" role="status">5 test NEAR sent to {beneficiary.trim()}.</p>
        )}
      </form>
    </aside>
  );
}
