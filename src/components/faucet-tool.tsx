'use client';

import { useNearWallet } from 'near-connect-hooks';
import { useNetwork } from '@/components/app-providers';
import { TestnetFaucet } from '@/components/testnet-faucet';

export function FaucetTool() {
  const { signedAccountId } = useNearWallet();
  const { network } = useNetwork();

  return (
    <section className="faucet-tool" aria-labelledby="faucet-tool-title">
      <h1 id="faucet-tool-title">Testnet faucet</h1>
      {network === 'testnet' ? (
        <TestnetFaucet accountId={signedAccountId} />
      ) : (
        <div className="card">
          <p>Switch to Testnet in the navigation to use the faucet.</p>
        </div>
      )}
    </section>
  );
}
