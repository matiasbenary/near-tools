'use client';

import { useQuery } from '@tanstack/react-query';
import { useNearWallet } from 'near-connect-hooks';
import { useNetwork } from '@/components/app-providers';
import { NetworkConfig } from '@/config';

export const IPFS = 'https://ipfs.near.social';

type SocialImage = { url?: string; ipfs_cid?: string; nft?: { contractId: string; tokenId: string } };

/** SocialDB `profile.image` → something an <img> can load. */
// ponytail: `nft` avatars fall back to the default icon; resolve via nft_token when someone asks
export const imageUrl = (image?: SocialImage) =>
  image?.ipfs_cid ? `${IPFS}/ipfs/${image.ipfs_cid}` : image?.url || null;

/** The account's SocialDB avatar URL, or null when it has none. */
export function useAvatar(accountId: string) {
  const { viewFunction } = useNearWallet();
  const { network } = useNetwork();

  return useQuery({
    queryKey: ['avatar', network, accountId],
    enabled: accountId.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const data = (await viewFunction({
        contractId: NetworkConfig[network].socialDb,
        method: 'get',
        args: { keys: [`${accountId}/profile/image/**`] },
      })) as Record<string, { profile?: { image?: SocialImage } }>;
      return imageUrl(data[accountId]?.profile?.image);
    },
  });
}
