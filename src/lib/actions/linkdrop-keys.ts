import type { NetworkId } from '@/config';

/**
 * A funded link is a private key that exists nowhere else: Keypom stores only the
 * public half, so if this browser loses its copy the drop is unspendable. Keys are
 * filed under the drop id — the reference implementation used the campaign name,
 * which silently overwrote the keys of an earlier drop with the same name.
 */
export type DropKey = { private: string; public: string };

const storageKey = (network: NetworkId, dropId: string) => `keysPom:${network}:${dropId}`;
const nameStorageKey = (network: NetworkId, dropId: string) => `dropName:${network}:${dropId}`;

/** Drop IDs whose secret keys were created and retained by this browser. */
export function loadStoredDropIds(network: NetworkId): string[] {
  try {
    const prefix = `keysPom:${network}:`;
    return Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index)
    )
      .filter((key): key is string => !!key?.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  } catch {
    return [];
  }
}

export function loadDropKeys(network: NetworkId, dropId: string): DropKey[] {
  try {
    return JSON.parse(window.localStorage.getItem(storageKey(network, dropId)) ?? '[]') as DropKey[];
  } catch {
    // ponytail: blocked or corrupt storage reads as "no keys here"
    return [];
  }
}

/**
 * Replaces, never appends: every create returns a fresh drop id, and near-drop
 * ids restart at 0 after a redeploy — appending merged a stale drop's keys into
 * the new one. ponytail: add an append path if top-ups ever ship.
 */
export function saveDropKeys(network: NetworkId, dropId: string, keys: DropKey[]) {
  try {
    window.localStorage.setItem(storageKey(network, dropId), JSON.stringify(keys));
    return true;
  } catch {
    return false;
  }
}

export function loadDropName(network: NetworkId, dropId: string): string {
  try {
    return window.localStorage.getItem(nameStorageKey(network, dropId)) ?? '';
  } catch {
    return '';
  }
}

export function saveDropName(network: NetworkId, dropId: string, name: string): boolean {
  try {
    window.localStorage.setItem(nameStorageKey(network, dropId), name.trim());
    return true;
  } catch {
    return false;
  }
}

/** Trailing slash: the site is a static export, so this is a directory index. */
export const claimUrl = (privateKey: string) =>
  `${window.location.origin}/claim/linkdrop/?id=${encodeURIComponent(privateKey)}`;

/**
 * A claim is signed by the link's own function-call key, so its cost has to fit
 * that key's allowance — and testnet does not bill it at the quoted gas price.
 * Three rejected claims there (2026-09-22) are exactly linear at 1e9 per gas,
 * 10x the 1e8 the network quotes, plus ~0.92 TGas of action fees:
 *
 *   44.000 TGas -> 4.49190e22   67.494 TGas -> 6.84128e22   100 TGas -> 1.00919e23
 *
 * Mainnet bills the quoted price: claim EEVnnBHwafFsjE8MeGVaQxFDWgDSbw3jgHs1nqZGxDmL
 * attached 275 TGas against a key funded with at most 6.1e22, which only fits
 * at 1x. The two networks run different protocol versions (86 vs 85), and the
 * RPC reports `pessimistic_gas_price_inflation_ratio` as [1, 1] on both — so
 * the receipts, not the config, are what these numbers come from.
 *
 * ponytail: constants fitted to those receipts. Re-fit them from the `cost:` of
 * any NotEnoughAllowance error.
 */
const PRICE_FACTOR: Record<NetworkId, bigint> = { mainnet: 1n, testnet: 10n };
const EXEC_FEE_GAS = 919_000_000_000n;

export const DEFAULT_CLAIM_GAS = 100_000_000_000_000n;

/** What the runtime bills against the key's allowance for this much gas. */
export const claimCost = (gas: bigint, gasPrice: bigint, network: NetworkId) =>
  (gas + EXEC_FEE_GAS) * gasPrice * PRICE_FACTOR[network];

/**
 * Keypom wants the *exact* gas the drop declares: a claim with anything else
 * logs "Prepaid GAS different than what is specified in the drop", hands over
 * nothing and still bills the attempt to the allowance (tx
 * 5ojUCH2mG4Uad5SqXsjk7UcyYh2HY8GwVqeXMAPEgpsZ). So there is no "attach what the
 * key can afford" — either it covers requiredGas or the link is unusable.
 *
 * Returns 0 when the allowance cannot pay for requiredGas, so the caller can
 * refuse to spend what is left on an attempt that cannot work.
 */
export const claimGas = (
  allowance: bigint,
  gasPrice: bigint,
  requiredGas: bigint,
  network: NetworkId
) => (claimCost(requiredGas, gasPrice, network) <= allowance ? requiredGas : 0n);

/** The abort above is a *successful* transaction, so only the logs give it away. */
export function claimAborted(outcome: unknown): boolean {
  const receipts = (outcome as { receipts_outcome?: { outcome: { logs?: string[] } }[] })
    .receipts_outcome;
  return (receipts ?? []).some((receipt) =>
    (receipt.outcome.logs ?? []).some((log) => /prepaid gas different/i.test(log))
  );
}

/** Drops the browser's copy of a drop's links — unclaimed ones become unspendable. */
export function forgetDrop(network: NetworkId, dropId: string) {
  try {
    window.localStorage.removeItem(storageKey(network, dropId));
    window.localStorage.removeItem(nameStorageKey(network, dropId));
  } catch {
    // ponytail: blocked storage has nothing to forget
  }
}
