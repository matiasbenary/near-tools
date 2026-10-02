export const tools = [
  { kind: 'stake', href: '/stake', label: 'Stake', title: 'Staking', description: 'Stake NEAR, compare validators, and manage liquid staking and lockup funds.' },
  { kind: 'ft', href: '/ft', label: 'FT', title: 'Fungible tokens', description: 'Create a token, view your holdings, and recover storage deposits.' },
  { kind: 'nft', href: '/nft', label: 'NFT', title: 'NFTs', description: 'Mint an NFT and browse your collection.' },
  { kind: 'linkdrop', href: '/linkdrop', label: 'Linkdrop', title: 'Linkdrops', description: 'Share NEAR, tokens, or NFTs through claim links and manage your drops.' },
  { kind: 'keys', href: '/cleanup', label: 'Key Cleanup', title: 'Key Cleanup', description: 'Revoke app keys you no longer use.' },
  { kind: 'faucet', href: '/faucet', label: 'Faucet', title: 'Testnet faucet', description: 'Get 5 test NEAR to try tools on testnet.' },
] as const;

export type ToolKind = (typeof tools)[number]['kind'];
