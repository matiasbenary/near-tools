/** JSON interface of near-drop/src/drop_types.rs. Amounts are decimal strings. */
export type CreateDrop =
  | { NEAR: { public_keys: string[]; amount_per_drop: string } }
  | { FT: { public_keys: string[]; ft_contract: string; amount_per_drop: string } }
  | { NFT: { public_key: string; nft_contract: string } };

export type OnChainDrop =
  | { NEAR: { funder: string; amount: string; counter: number } }
  | { FT: { funder: string; amount: string; ft_contract: string; counter: number; funded: boolean } }
  | { NFT: { funder: string; token_id: string; nft_contract: string } };

export function createDropArgs(
  asset: 'near' | 'ft' | 'nft',
  publicKeys: string[],
  amount: bigint,
  tokenContract: string
): { drop: CreateDrop } {
  if (asset === 'nft') return { drop: { NFT: { public_key: publicKeys[0], nft_contract: tokenContract } } };
  const common = { public_keys: publicKeys, amount_per_drop: amount.toString() };
  return asset === 'near'
    ? { drop: { NEAR: common } }
    : { drop: { FT: { ...common, ft_contract: tokenContract } } };
}

export const dropData = (drop: OnChainDrop) => 'NEAR' in drop ? drop.NEAR : 'FT' in drop ? drop.FT : drop.NFT;
export const dropReady = (drop: OnChainDrop) => 'FT' in drop ? drop.FT.funded : 'NFT' in drop ? !!drop.NFT.token_id : true;

// The contract grants 0.033 NEAR per access key for a 32 TGas claim plus fees.
export const CLAIM_GAS = 32_000_000_000_000n;

/** NEP-642 buys prepaid gas at >= 0.001 NEAR/TGas. Include a fee margin. */
export const claimCost = (gas: bigint, gasPrice: bigint) =>
  (gas + 1_000_000_000_000n) * (gasPrice > 1_000_000_000n ? gasPrice : 1_000_000_000n);

export const canClaim = (allowance: string | null | undefined, gasPrice: bigint, gas: bigint) =>
  allowance == null || BigInt(allowance) >= claimCost(gas, gasPrice);

/** The claim promise resolves to JSON true only when the asset was delivered. */
export function claimSucceeded(outcome: unknown): boolean {
  const result = outcome as { status?: { SuccessValue?: string } };
  return result.status?.SuccessValue === 'dHJ1ZQ==';
}
