import type { NetworkId } from '@/config';

export type HeldToken = {
  contractId: string;
  symbol: string;
  decimals: number;
  balance: bigint;
  icon?: string;
  stale?: boolean;
};
export type TokenMetadata = { symbol?: string; decimals?: number; icon?: string };
export type DiscoveredToken = { contractId: string; balance?: string; metadata?: TokenMetadata };

// Share the limit between holdings and storage checks, rather than running two batches at once.
let activeRequests = 0;
const waiting: (() => void)[] = [];
export async function limitTokenRequests<T>(read: () => Promise<T>): Promise<T> {
  if (activeRequests >= 3) await new Promise<void>((resolve) => waiting.push(resolve));
  else activeRequests++;
  try { return await read(); }
  finally {
    const next = waiting.shift();
    if (next) next();
    else activeRequests--;
  }
}
const storageKey = (network: NetworkId, accountId: string) => `ftHoldings:${network}:${accountId}`;

/** Last successful snapshot also remembers contracts that indexers omit later. */
export function loadHoldings(network: NetworkId, accountId: string): HeldToken[] | undefined {
  try {
    const raw = window.localStorage.getItem(storageKey(network, accountId));
    if (!raw) return undefined;
    return (JSON.parse(raw) as (Omit<HeldToken, 'balance'> & { balance: string })[])
      .map((token) => ({ ...token, balance: BigInt(token.balance) }));
  } catch {
    return undefined;
  }
}

export function saveHoldings(network: NetworkId, accountId: string, tokens: HeldToken[]) {
  try {
    window.localStorage.setItem(storageKey(network, accountId), JSON.stringify(
      tokens.map((token) => ({ ...token, balance: token.balance.toString() }))
    ));
  } catch {
    // In-memory query data still works when browser storage is unavailable.
  }
}

/** Discover contracts through either index; amounts always come from RPC. */
export async function readTokenHoldings({ known, sources, balanceOf, metadataOf, registered }: {
  known: HeldToken[];
  sources: Promise<DiscoveredToken[]>[];
  balanceOf: (contractId: string) => Promise<bigint>;
  metadataOf: (contractId: string) => Promise<TokenMetadata>;
  registered: (contractId: string) => Promise<boolean>;
}): Promise<HeldToken[]> {
  const discovered = await Promise.allSettled(sources);
  const candidates = new Map<string, TokenMetadata>();
  const fallback = new Map(known.filter((token) => token.contractId !== 'near').map((token) => [token.contractId, token]));
  for (const token of known) if (token.contractId !== 'near') candidates.set(token.contractId, token);
  let successfulSources = 0;
  for (const source of discovered) {
    if (source.status !== 'fulfilled') continue;
    successfulSources++;
    for (const token of source.value) {
      const previous = candidates.get(token.contractId);
      candidates.set(token.contractId, { ...token.metadata, ...previous });
      if (!fallback.has(token.contractId) && token.balance !== undefined && token.metadata?.decimals !== undefined) {
        try {
          fallback.set(token.contractId, { contractId: token.contractId, balance: BigInt(token.balance),
            decimals: token.metadata.decimals, symbol: token.metadata.symbol ?? token.contractId,
            ...(token.metadata.icon ? { icon: token.metadata.icon } : {}), stale: true });
        } catch { /* Ignore malformed indexed amounts. */ }
      }
    }
  }
  if (successfulSources === 0 && candidates.size === 0)
    throw new Error('Token discovery is unavailable. Try again shortly.');

  const ids = [...candidates.keys()].sort();
  const tokens: HeldToken[] = [];
  // A broken or unavailable token must not prevent other tokens from loading.
  for (let i = 0; i < ids.length; i += 5) {
    const batch = await Promise.allSettled(ids.slice(i, i + 5).map(async (contractId) => {
      const balance = await balanceOf(contractId);
      if (balance === 0n && !await registered(contractId)) return null;
      let metadata = candidates.get(contractId)!;
      if (metadata.decimals === undefined) metadata = await metadataOf(contractId);
      if (!Number.isInteger(metadata.decimals) || metadata.decimals! < 0 || metadata.decimals! > 255)
        throw new Error(`Invalid FT metadata on ${contractId}`);
      return { contractId, symbol: metadata.symbol ?? contractId, decimals: metadata.decimals!,
        balance, ...(metadata.icon ? { icon: metadata.icon } : {}) };
    }));
    batch.forEach((result, offset) => {
      if (result.status === 'fulfilled') {
        if (result.value) tokens.push(result.value);
      } else {
        const previous = fallback.get(ids[i + offset]);
        if (previous) tokens.push({ ...previous, stale: true });
      }
    });
  }
  return tokens;
}
