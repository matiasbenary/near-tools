import { nearToYocto } from 'near-api-js';
import { FungibleToken } from 'near-api-js/tokens';
import type { NetworkId } from '@/config';

/** Network-specific contract IDs and shared token types and unit helpers. */

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

export const ActionContracts: Record<NetworkId, Record<ActionKind, { contractId: string }>> = {
  mainnet: {
    ft: { contractId: 'token.primitives.near' },
    nft: { contractId: 'nft.primitives.near' },
    linkdrop: { contractId: 'linkdrop.primitives.near' },
  },
  testnet: {
    ft: { contractId: 'token.primitives.testnet' },
    nft: { contractId: 'nft.primitives.testnet' },
    linkdrop: { contractId: 'linkdrop.primitives.testnet' },
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
