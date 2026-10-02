# Simplr Tools

A non-custodial web console for NEAR. Connect a NEAR wallet to stake, create tokens and linkdrops, and manage access keys on mainnet or testnet.

Based on [matiasbenary/stakeguard](https://github.com/matiasbenary/stakeguard).

## What it does

- `/`: introduces all tools in a single landing page. Each tool page prompts signed-out visitors to log in.
- `/stake`: staking, validator comparison, and lockup management.
- Lists active NEAR validators with net APY, uptime, stake percentage, and fee.
- Keeps Meta Pool and LiNEAR available as liquid-staking options.
- Displays direct staking balances, liquid-token balances, and pending withdrawals.
- Supports staking, normal unstaking, withdrawals, and Meta Pool fast unstaking.
- Discovers the connected account's standard lockup on mainnet (`lockup.near`) and testnet (`lockup.devnet`) and supports unstaking, withdrawal into the lockup, and transfer of available funds to its owner.
- Shows a combined staking overview, including lockup positions, and reviews transactions before wallet approval.
- `/ft`: creates fungible tokens, lists the account's FT holdings (Ref Finance whitelist marks verified ones), and unregisters empty or unwanted tokens to recover their storage deposit.
- `/nft`: mints NFTs, lists the account's NFTs.
- `/linkdrop`: creates NEAR, FT, or NFT linkdrops, uses `linkdrop.primitives.{near,testnet}` to quote and create drops, lists this browser’s drops with their claim/funding status, and cancels remaining links with direct refunds. FT drops use a follow-up transfer; NFT drops use approval.
- `/claim/linkdrop`: claims a linkdrop into an existing wallet account.
- `/cleanup`: revokes function-call access keys. Full-access keys are never shown.
- `/faucet`: a testnet-only tool that funds an account with 5 test NEAR.
- Uses the connected wallet for transactions. Wallet private keys stay in the wallet. Linkdrop secret keys are generated and saved locally in the browser.

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
npm run check   # tsc + scripts/check-actions.ts self-check
npm run build
npm run start
```

## Network

Use the navigation switch to move between NEAR mainnet and testnet. The selected network is remembered in the browser. RPC endpoints, account-indexer URLs, explorer links, and network-specific liquid-pool configuration live in [`src/config.ts`](src/config.ts).

## GitHub Pages

In the repository's **Settings → Pages**, choose **GitHub Actions** as the build source. The workflow in `.github/workflows/deploy.yml` checks and exports the site, then deploys `out/` on pushes to `main`, manual runs, and hourly validator refreshes.

For `simplr.tools`, set that custom domain in **Settings → Pages** and configure its DNS as described in [GitHub's custom domain guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site). The workflow reads the site's configured base path, supporting both the repository URL and a custom domain.

To reproduce a repository-path export locally, run `NEXT_PUBLIC_BASE_PATH=/near-tools npx next build`. Without that variable, the export serves from `/`.

## Data sources

The deployed mainnet validator directory is a static `validators.json` snapshot. The GitHub Pages workflow refreshes it hourly using NearBlocks v3, so page visitors do not call NearBlocks for the mainnet validator table. Testnet validators are read from the testnet RPC. Account staking positions are discovered through the network-specific FastNEAR endpoint and then verified with each pool contract's `get_account` view method. Liquid-staking token balances use `ft_balance_of` where configured.

FT holdings come from the NearBlocks inventory, and each balance is confirmed with an on-chain `ft_balance_of`, because legacy tokens emit no events and NearBlocks can show stale balances. Storage recovery reads the FastNEAR token list and each contract's `storage_balance_of`.

To authenticate snapshot refreshes, add a repository Actions secret named `NEARBLOCKS_API_KEY`. It is supplied only to the workflow's generator step and is not included in the generated site or browser requests.

## Notes

Staking and liquid-staking products carry protocol, validator, smart-contract, and market risks. APY, uptime, and fees are informational values supplied by third-party data sources and may be delayed or unavailable. Always review the transaction details in the wallet before approving.
