import { teraToGas, yoctoToNear } from 'near-api-js';

/** Chain-wide helpers shared by staking and the FT / NFT / Linkdrop actions. */

export const GAS = teraToGas('30');
export const GAS_300 = teraToGas('300');

/** Covers the zero-balance storage registration most FT contracts ask for. */
export const FT_STORAGE_DEPOSIT = 125n * 10n ** 19n; // 0.00125 Ⓝ

const MIN_DISPLAY = 10n ** 22n; // 0.01 at the displayed precision

/** "1.23 Ⓝ", "< 0.01 stNEAR" — dust never reads as zero. */
export const formatNear = (amount: bigint, unit = 'Ⓝ') =>
  amount > 0n && amount < MIN_DISPLAY ? `< 0.01 ${unit}` : `${yoctoToNear(amount, 2)} ${unit}`;

/** Full precision, no grouping commas — what a number <input> accepts. */
export const toInputAmount = (amount: bigint) => yoctoToNear(amount).replace(/,/g, '');

/** NEAR returns a FinalExecutionOutcome; the hash lives in a couple of shapes. */
export function txHashOf(outcome: unknown): string | undefined {
  const o = outcome as
    | { transaction?: { hash?: string }; transaction_outcome?: { id?: string } }
    | undefined;
  return o?.transaction?.hash ?? o?.transaction_outcome?.id;
}

/**
 * A refetch right after a tx still reads the old state: views run at `final`
 * (~2 blocks behind) and FT balances come from NearBlocks, which indexes later.
 * ponytail: fixed retry schedule; poll-until-changed if the indexer lags more.
 */
export function refreshAfterTx(refetch: () => void) {
  for (const delay of [0, 3_000, 10_000, 30_000]) setTimeout(refetch, delay);
}
