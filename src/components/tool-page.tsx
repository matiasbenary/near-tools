'use client';
import { ReactNode } from 'react';
import { useNearWallet } from 'near-connect-hooks';
import { useNetwork } from '@/components/app-providers';

type Kind = 'stake' | 'ft' | 'nft' | 'linkdrop' | 'keys';

const connectStep: [string, string] = [
  'Connect your wallet',
  'Sign in with any NEAR wallet. No account creation needed.',
];

const copy: Record<Kind, { label: string; title: ReactNode; lead: string; steps: [string, string][] }> = {
  stake: {
    label: 'NEAR Protocol',
    title: <>Stake <em>NEAR</em><br />earn rewards</>,
    lead: 'Delegate your tokens to a validator and earn staking rewards every epoch. Non-custodial: your keys, your NEAR.',
    steps: [
      connectStep,
      ['Choose a validator', 'Pick a validator on this network. Tokens stay under your control at all times.'],
      ['Earn every epoch', 'Rewards are distributed roughly every 12 hours and compound into your stake.'],
    ],
  },
  ft: {
    label: 'Fungible token',
    title: <>Launch your <em>token</em><br />on NEAR</>,
    lead: 'Deploy a NEP-141 token through an audited factory. The cost is quoted before you sign, and the contract ends up under your account.',
    steps: [
      connectStep,
      ['Describe the token', 'Name, symbol, decimals and supply. Everything is validated before it reaches your wallet.'],
      ['Sign once', 'The factory deploys the contract and the full supply lands in your account.'],
    ],
  },
  nft: {
    label: 'NFT',
    title: <>Mint an <em>NFT</em><br />in minutes</>,
    lead: 'Mint a token into the shared collection. Your image goes to IPFS and your wallet owns the result.',
    steps: [
      connectStep,
      ['Upload the artwork', 'The image is pinned to IPFS and the metadata points at it.'],
      ['Sign the mint', 'The token is minted to your account. Transfer it whenever you want.'],
    ],
  },
  linkdrop: {
    label: 'Linkdrop',
    title: <>Share NEAR<br />with a <em>link</em></>,
    lead: 'Fund claim links with NEAR or any token you hold. Secret keys are generated in your browser and never leave it.',
    steps: [
      connectStep,
      ['Pick an amount', 'Choose NEAR or a token you hold and how many links to create.'],
      ['Share the links', 'Anyone with a link can claim, even without a wallet yet.'],
    ],
  },
  keys: {
    label: 'Account cleanup',
    title: <>Clean up your<br /><em>account</em></>,
    lead: 'Recover NEAR locked in storage deposits and revoke app keys you no longer use. Full-access keys are never shown or removed here.',
    steps: [
      connectStep,
      ['Review permissions', 'See which contract each key can call, its allowed methods and remaining allowance.'],
      ['Revoke safely', 'Delete one app key or revoke every function-call key in a single wallet approval.'],
    ],
  },
};

/**
 * Every top-level page has the same three states: wallet loading, a landing for
 * signed-out visitors, and the tool itself once signed in.
 */
export function ToolPage({ kind, children }: { kind: Kind; children: ReactNode }) {
  const { signedAccountId, loading, signIn } = useNearWallet();
  const { network } = useNetwork();
  const t = copy[kind];

  if (loading) {
    return (
      <main className="wrap connector-loading" aria-busy="true">
        <section className="connector-loading-panel" aria-labelledby="connector-loading-title">
          <div className="connector-loading-signal" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p className="connector-loading-label">NEAR Stake</p>
          <h1 id="connector-loading-title">{t.label}</h1>
          <p className="connector-loading-copy" role="status">The page is loading...</p>
        </section>
      </main>
    );
  }

  if (!signedAccountId) {
    return (
      <main className="wrap">
        <section className="hero hero-single">
          <div className="hero-copy">
            <span className="tag">{t.label} · {network}</span>
            <h1>{t.title}</h1>
            <p>{t.lead}</p>
            <button className="btn hero-cta" onClick={() => signIn()}>Connect wallet</button>
          </div>
        </section>

        <section className="steps">
          <h2>How it works</h2>
          {t.steps.map(([title, body], i) => (
            <div className="step" key={title}>
              <span className="num">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </div>
          ))}
        </section>
      </main>
    );
  }

  // key: a different account starts from a clean slate, not the last one's form or selection
  return (
    <main key={signedAccountId} className={kind === 'stake' ? 'wrap' : 'wrap actions-page'}>
      {children}
    </main>
  );
}
