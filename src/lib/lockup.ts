import { teraToGas } from 'near-api-js';
import type { PoolAccount } from './staking';

export const LOCKUP_GAS = {
  unstake: teraToGas('125').toString(),
  withdrawAll: teraToGas('175').toString(),
  transfer: teraToGas('50').toString(),
  checkTransfers: teraToGas('75').toString(),
};

export type LockupPosition = {
  id: string;
  ownerId: string;
  poolId: string | null;
  poolAccount: PoolAccount | null;
  accountBalance: bigint;
  lockedBalance: bigint;
  transferableBalance: bigint;
  transfersEnabled: boolean;
};

export async function getLockupAccountId(ownerId: string, suffix: string): Promise<string> {
  const bytes = new TextEncoder().encode(ownerId);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const prefix = Array.from(hash.slice(0, 20), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}.${suffix}`;
}

export function isMissingAccount(error: unknown, accountId: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (typeof error === 'object' && error !== null &&
    'accountId' in error && error.accountId === accountId &&
    error.constructor.name === 'AccountDoesNotExistError') return true;
  return message.includes(`Account ${accountId} does not exist at block height`) ||
    message.includes(`account ${accountId} does not exist while viewing`);
}
