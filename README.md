# NEAR Tools

A non-custodial web console for NEAR. Connect a NEAR wallet to stake, create tokens and linkdrops, and manage access keys on mainnet or testnet.

Based on [matiasbenary/stakeguard](https://github.com/matiasbenary/stakeguard).

## What it does

- Lists active NEAR validators with net APY, uptime, stake percentage, and fee.
- Keeps Meta Pool and LiNEAR available as liquid-staking options.
- Displays direct staking balances, liquid-token balances, and pending withdrawals.
- Supports staking, normal unstaking, withdrawals, and Meta Pool fast unstaking.
- `/ft`: creates fungible tokens, lists the account's FT holdings, and sends them.
- `/nft`: mints NFTs, lists the account's NFTs, and sends them.
- `/linkdrop`: creates NEAR, FT, or NFT linkdrops, lists created drops with their claimed status, and deletes unclaimed ones.
- `/claim/linkdrop`: claims a linkdrop into an existing account or a new one.
- `/keys`: lists the account's function-call access keys and revokes one or all of them. Full-access keys are never shown.
- Provides a built-in testnet-only faucet that funds an account with 5 test NEAR.
- Uses the connected wallet for transactions. This app never receives or stores private keys.

## Stack

- Next.js 15 and React 18
- TypeScript
- `near-connect-hooks` and `near-api-js`
- TanStack Table for validator sorting

## Run locally

Requirements: Node.js 20 or later and npm.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Other commands:

```bash
npx tsc --noEmit
npm run build
npm run start
```

## Network

Use the navigation switch to move between NEAR mainnet and testnet. The selected network is remembered in the browser. RPC endpoints, account-indexer URLs, explorer links, and network-specific liquid-pool configuration live in [`src/config.ts`](src/config.ts).

## Data sources

The deployed mainnet validator directory is a static `validators.json` snapshot. The GitHub Pages workflow refreshes it hourly using NearBlocks v3, so page visitors do not call NearBlocks for the mainnet validator table. Testnet validators are read from the testnet RPC. Account staking positions are discovered through the network-specific FastNEAR endpoint and then verified with each pool contract's `get_account` view method. Liquid-staking token balances use `ft_balance_of` where configured.

To authenticate snapshot refreshes, add a repository Actions secret named `NEARBLOCKS_API_KEY`. It is supplied only to the workflow's generator step and is not included in the generated site or browser requests.

## Notes

Staking and liquid-staking products carry protocol, validator, smart-contract, and market risks. APY, uptime, and fees are informational values supplied by third-party data sources and may be delayed or unavailable. Always review the transaction details in the wallet before approving.
