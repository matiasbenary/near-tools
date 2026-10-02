'use client';

import { ReactNode } from 'react';
import { useNearWallet } from 'near-connect-hooks';
import { tools, ToolKind } from '@/lib/tools';

/** Tool routes share wallet loading, login, and connected states. */
export function ToolPage({ kind, children }: { kind: ToolKind; children: ReactNode }) {
  const { signedAccountId, loading, signIn } = useNearWallet();
  const tool = tools.find((item) => item.kind === kind)!;

  if (loading) {
    return (
      <main className="wrap connector-loading" aria-busy="true">
        <section className="connector-loading-panel" aria-labelledby="connector-loading-title">
          <div className="connector-loading-signal" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p className="connector-loading-label">Simplr Tools</p>
          <h1 id="connector-loading-title">{tool.title}</h1>
          <p className="connector-loading-copy" role="status">The page is loading...</p>
        </section>
      </main>
    );
  }

  if (!signedAccountId) {
    return (
      <main className="wrap tool-login">
        <section aria-labelledby="tool-login-title">
          <h1 id="tool-login-title">{tool.title}</h1>
          <p>Login to use this tool</p>
          <button className="btn" onClick={() => signIn()}>Login</button>
        </section>
      </main>
    );
  }

  // A different account starts with a clean form and selection.
  return (
    <main key={signedAccountId} className={kind === 'stake' ? 'wrap' : 'wrap actions-page'}>
      {children}
    </main>
  );
}
