import { nearToYocto } from 'near-api-js';
import { FungibleToken } from 'near-api-js/tokens';
import type { NetworkId } from '@/config';

/**
 * Every contract ID, method name and deposit formula for the FT / NFT / Linkdrop
 * actions lives here, once, per network.
 *
 * Verified against free.rpc.fastnear.com and test.rpc.fastnear.com on 2026-09-21:
 *  - nft.primitives.{near,testnet} differ in code_hash but expose the same NEP-171 surface.
 * FT factory quote calls are configured separately for each network.
 */

export type ActionKind = 'ft' | 'nft' | 'linkdrop';

export type FtMetadata = {
  spec: 'ft-1.0.0';
  name: string;
  symbol: string;
  icon: string;
  decimals: number;
};

export type FtCreateArgs = {
  owner_id: string;
  total_supply: string;
  metadata: FtMetadata;
};

/** A view call the caller passes straight to viewFunction(). Kept as data so it is testable. */
export type ViewRequest = { contractId: string; method: string; args: unknown };

type FtFactory = {
  contractId: string;
  /** Token accounts are derived from the symbol — the user never types one. */
  accountFor: (symbol: string) => string;
  /** Exact deposit for this token, in yocto. Interface differs per network. */
  quote: (args: FtCreateArgs, accountId: string) => ViewRequest;
  createMethod: string;
};

export const ActionContracts: Record<
  NetworkId,
  {
    ft: FtFactory;
    nft: { contractId: string; mintMethod: string };
    linkdrop: {
      contractId: string;
      createMethod: string;
    };
  }
> = {
  mainnet: {
    ft: {
      contractId: 'token.primitives.near',
      accountFor: (symbol) => `${normalizeSymbol(symbol)}.token.primitives.near`,
      quote: (args, accountId) => ({
        contractId: 'token.primitives.near',
        method: 'get_required',
        args: { args, account_id: accountId },
      }),
      createMethod: 'create_token',
    },
    nft: { contractId: 'nft.primitives.near', mintMethod: 'nft_mint' },
    linkdrop: {
      contractId: 'linkdrop.primitives.near',
      createMethod: 'create_drop',
    },
  },
  testnet: {
    ft: {
      contractId: 'token.primitives.testnet',
      accountFor: (symbol) => `${normalizeSymbol(symbol)}.token.primitives.testnet`,
      quote: (args) => ({
        contractId: 'token.primitives.testnet',
        method: 'get_required',
        args: { args },
      }),
      createMethod: 'create_token',
    },
    nft: { contractId: 'nft.primitives.testnet', mintMethod: 'nft_mint' },
    linkdrop: {
      contractId: 'linkdrop.primitives.testnet',
      createMethod: 'create_drop',
    },
  },
};

/** Account IDs are lowercase; the symbol field is displayed uppercase. */
export const normalizeSymbol = (symbol: string) => symbol.trim().toLowerCase();

export const ONE_NEAR = nearToYocto(1);

/**
 * Storage cost of an nft_mint, estimated from the serialized args.
 * 1e19 yocto per byte, times 4 for the contract's own bookkeeping.
 */
export function nftMintDeposit(args: unknown): bigint {
  return BigInt(JSON.stringify(args).length) * 10n ** 19n * 4n;
}

/** near-api-js does the unit math; the metadata beyond `decimals` is unused. */
const units = (decimals: number) =>
  new FungibleToken('', { name: '', symbol: '', decimals });

/** Human supply → on-chain integer supply, without floating point. */
export function ftTotalSupply(supply: string, decimals: number): bigint {
  return units(decimals).toUnits(supply);
}

/** Human amount → on-chain integer. Truncates, never rounds up. */
export function toUnits(amount: string, decimals: number): bigint {
  return units(decimals).toUnits(amount);
}

/** On-chain integer → a short human string. */
export function fromUnits(amount: bigint, decimals: number, places = 4): string {
  return units(decimals).toDecimal(amount, places);
}
