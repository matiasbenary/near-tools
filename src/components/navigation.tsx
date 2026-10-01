'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useNearWallet } from 'near-connect-hooks';
import { CircleUserRound, LogOut } from 'lucide-react';
import { useNetwork } from '@/components/app-providers';
import { useAvatar } from '@/hooks/use-avatar';
import { networkBlockReasons } from '@/lib/network-guards';

import NearLogo from '../../public/near-logo.svg';

export const Navigation = () => {
  const { signedAccountId, loading, signIn, signOut } = useNearWallet();
  const { network, setNetwork } = useNetwork();
  const pathname = usePathname();
  const { data: avatar } = useAvatar(signedAccountId ?? '');
  // ponytail: remember the URL that failed; a new avatar URL retries on its own
  const [brokenAvatar, setBrokenAvatar] = useState<string | null>(null);
  // ponytail: native <dialog> — modal, focus trap and Esc come free
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<{ next: typeof network; reasons: string[] } | null>(null);

  useEffect(() => {
    if (pending) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [pending]);

  const applySwitch = (next: typeof network) => {
    if (signedAccountId) signOut();
    setNetwork(next);
  };

  const switchNetwork = (next: typeof network) => {
    if (next === network) return;
    const reasons = networkBlockReasons();
    if (signedAccountId) reasons.push(`You will be signed out of ${signedAccountId}.`);
    if (reasons.length === 0) return applySwitch(next);
    setPending({ next, reasons });
  };

  return (
    <nav className="nav">
      <div className="wrap nav-inner">
        <Link href="/" className="brand">
          <Image priority src={NearLogo} alt="NEAR" width={26} height={26} />
          <span className="brand-label">NEAR</span>
        </Link>
        <div className="nav-links" aria-label="Primary navigation">
          {[
            { href: '/', label: 'Stake' },
            { href: '/ft', label: 'FT' },
            { href: '/nft', label: 'NFT' },
            { href: '/linkdrop', label: 'Linkdrop' },
            { href: '/cleanup', label: 'Cleanup' },
          ].map(({ href, label }) => (
            <Link key={href} href={href} className={pathname === href ? 'active' : ''}>
              {label}
            </Link>
          ))}
        </div>
        <div className="nav-actions">
          <div className="network-switch" role="group" aria-label="NEAR network">
            {(['mainnet', 'testnet'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={network === option ? 'active' : ''}
                aria-pressed={network === option}
                onClick={() => switchNetwork(option)}
              >
                {option === 'mainnet' ? 'Mainnet' : 'Testnet'}
              </button>
            ))}
          </div>
          <button
            className={signedAccountId ? 'btn btn-ghost wallet-button' : 'btn wallet-button'}
            disabled={loading}
            onClick={() => (signedAccountId ? signOut() : signIn())}
            title={signedAccountId ? `Logout ${signedAccountId}` : undefined}
          >
            {loading ? (
              'Loading…'
            ) : signedAccountId ? (
              <>
                {avatar && avatar !== brokenAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="avatar" src={avatar} alt="" onError={() => setBrokenAvatar(avatar)} />
                ) : (
                  <CircleUserRound size={16} aria-hidden="true" />
                )}
                <span className="wallet-name">{signedAccountId}</span>
                <LogOut size={14} aria-label="Logout" />
              </>
            ) : (
              'Connect wallet'
            )}
          </button>
        </div>
      </div>

      <dialog className="confirm-dialog" ref={dialogRef} onClose={() => setPending(null)}>
        {pending && (
          <>
            <h2>Switch to {pending.next}?</h2>
            <ul>
              {pending.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <div className="confirm-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  applySwitch(pending.next);
                  setPending(null);
                }}
              >
                Switch
              </button>
            </div>
          </>
        )}
      </dialog>
    </nav>
  );
};
