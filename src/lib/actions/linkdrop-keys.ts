import type { NetworkId } from '@/config';

export type DropKey = { private: string; public: string };
export type DropScope = { network: NetworkId; contractId: string; accountId: string };

type StoredDrop = { keys: DropKey[]; name: string };
const prefix = (scope: DropScope) => `nearDrop:${scope.network}:${scope.contractId}:${scope.accountId}:`;
const storageKey = (scope: DropScope, dropId: string) => prefix(scope) + dropId;

/** There is no contract owner index; only this browser's records can be listed. */
export function loadStoredDropIds(scope: DropScope): string[] {
  try {
    const start = prefix(scope);
    return Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i))
      .filter((key): key is string => !!key?.startsWith(start))
      .map((key) => key.slice(start.length));
  } catch {
    return [];
  }
}

function loadDrop(scope: DropScope, dropId: string): StoredDrop {
  try {
    return JSON.parse(window.localStorage.getItem(storageKey(scope, dropId)) ?? 'null') ?? { keys: [], name: '' };
  } catch {
    return { keys: [], name: '' };
  }
}

export const loadDropKeys = (scope: DropScope, dropId: string) => loadDrop(scope, dropId).keys;
export const loadDropName = (scope: DropScope, dropId: string) => loadDrop(scope, dropId).name;

/** Scope by deployment and funder: IDs restart at zero on a new contract. */
export function saveDrop(scope: DropScope, dropId: string, keys: DropKey[], name: string): boolean {
  try {
    window.localStorage.setItem(storageKey(scope, dropId), JSON.stringify({ keys, name: name.trim() }));
    return true;
  } catch {
    return false;
  }
}

/** Forget only after cancellation succeeds, or all stored keys are gone on-chain. */
export function forgetDrop(scope: DropScope, dropId: string) {
  try {
    window.localStorage.removeItem(storageKey(scope, dropId));
  } catch {
    // The on-chain cancellation still succeeds if storage is unavailable.
  }
}

/** Include the network so a testnet recipient opens the right contract. */
export const claimUrl = (privateKey: string, network: NetworkId) => {
  const basePath = process.env.__NEXT_ROUTER_BASEPATH ?? '';
  return `${window.location.origin}${basePath}/claim/linkdrop/?id=${encodeURIComponent(privateKey)}&network=${network}`;
};
