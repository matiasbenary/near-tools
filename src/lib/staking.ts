import { nearToYocto } from 'near-api-js';
import { NetworkId } from '@/config';

export const GAS_RESERVE = nearToYocto(0.1); // keep 0.1 Ⓝ in the wallet for gas

export type Validator = {
  id: string;
  liquid: boolean;
  uptime?: number;
  stakePercent?: number;
};
export type PoolAccount = {
  staked_balance: string;
  unstaked_balance: string;
  can_withdraw: boolean;
};
export type Position = {
  id: string;
  staked_balance: bigint;
  unstaked_balance: bigint;
  can_withdraw: boolean;
};
export type Fee = { numerator: number; denominator: number };
export type ValidatorData = {
  pools: Validator[];
  fees: Record<string, number>;
  apy: number | null;
};

export const apyNum = (baseApy: number | null, fee: number | undefined) =>
  baseApy !== null && fee !== undefined ? baseApy * (1 - fee) : -1;

export const apyLabel = (baseApy: number | null, fee: number | undefined) => {
  const n = apyNum(baseApy, fee);
  return n >= 0 ? `${n.toFixed(1)}%` : '—';
};

/** Meta Pool's fast exit refuses to pay out less than 95% of the quoted NEAR. */
export const minFastUnstake = (expected: bigint) => (expected * 95n) / 100n;

export async function getValidatorData(network: NetworkId): Promise<ValidatorData> {
  if (network === 'testnet') return { pools: [], fees: {}, apy: null };
  const response = await fetch('./validators.json');
  if (!response.ok) throw new Error(`Validator snapshot request failed (${response.status})`);
  return response.json() as Promise<ValidatorData>;
}
