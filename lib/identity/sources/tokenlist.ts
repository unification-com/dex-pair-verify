// Token-list-membership identity source (T1). Membership in a reputable,
// curated token list (Uniswap default, CoinGecko per-network) is a strong
// positive legitimacy signal — these lists don't carry spoof/impostor tokens.
//
// All entries are the Uniswap token-list standard (`{ tokens: [{ chainId,
// address, … }] }`), so one parser handles every list. Lists are fetched once
// per process and cached (they change slowly); a failed fetch degrades to "no
// membership", never an error — the ≥2-category rule means a missing list just
// means GoPlus must also vouch.

import { fetchWithBackoff } from "../../httpBackoff";
import { IdentitySignal } from "../types";

type TokenListEntry = { chainId?: number; address?: string };
type TokenListDoc = { tokens?: TokenListEntry[] };

// Curated lists, all Uniswap-token-list-standard (multi-chain lists are filtered
// by chainId). Mix of NON-CoinGecko curations (Uniswap, 1inch — independent of
// CG, so they can vouch for a token GeckoTerminal never gave a cgId) + CoinGecko
// per-network lists (comprehensive coverage). Tune/extend freely — a dead or
// non-JSON URL just yields no membership for that list (never crashes the pass).
// NB: `tokens.uniswap.org` 302-redirects to HTML; the real JSON is the IPNS URL.
export const TOKEN_LISTS: { name: string; url: string }[] = [
  { name: "uniswap-default", url: "https://ipfs.io/ipns/tokens.uniswap.org" },
  { name: "1inch", url: "https://tokens.1inch.eth.link" },
  { name: "coingecko-eth", url: "https://tokens.coingecko.com/ethereum/all.json" },
  { name: "coingecko-bsc", url: "https://tokens.coingecko.com/binance-smart-chain/all.json" },
  { name: "coingecko-polygon", url: "https://tokens.coingecko.com/polygon-pos/all.json" },
  { name: "coingecko-xdai", url: "https://tokens.coingecko.com/xdai/all.json" },
  // 4.D chains — were uncovered (B1b).
  { name: "coingecko-base", url: "https://tokens.coingecko.com/base/all.json" },
  { name: "coingecko-arbitrum", url: "https://tokens.coingecko.com/arbitrum-one/all.json" },
  { name: "coingecko-optimism", url: "https://tokens.coingecko.com/optimistic-ethereum/all.json" },
  // Primary-DEX curated lists for long-tail, chain-native tokens that the CoinGecko
  // per-chain lists (CoinGecko-listed only) and the Uniswap default (major tokens)
  // both miss — the chain's own main DEX is the authority there (archetype: a $54M
  // PancakeSwap BSC token absent from CoinGecko). Standard Uniswap-tokenlist format,
  // self-sufficient like the others: a curated listing confirms IDENTITY (the token
  // is a known listing), not safety — the scam / honeypot / phantom-liquidity gates
  // still run downstream. Each verified reachable + tokens[]-shaped 2026-06-08.
  { name: "pancakeswap-extended", url: "https://tokens.pancakeswap.finance/pancakeswap-extended.json" }, // BSC
  { name: "quickswap-polygon", url: "https://unpkg.com/quickswap-default-token-list/build/quickswap-default.tokenlist.json" }, // Polygon
  { name: "optimism-superchain", url: "https://static.optimism.io/optimism.tokenlist.json" }, // Optimism + Base
  { name: "arbitrum-foundation", url: "https://tokenlist.arbitrum.io/ArbTokenLists/arbed_arb_whitelist_era.json" }, // Arbitrum
  { name: "honeyswap-gnosis", url: "https://tokens.honeyswap.org" }, // Gnosis (xdai) (+ some Polygon)
];

const LIST_TTL_MS = 24 * 60 * 60 * 1000;
const memberKey = (chainId: number, address: string): string => `${chainId}:${address.toLowerCase()}`;

export type ListFetcher = (url: string) => Promise<TokenListDoc | null>;

const defaultListFetcher: ListFetcher = async (url) => {
  const res = await fetchWithBackoff(url, undefined, `tokenlist ${url}`);
  if (!res) {
    return null;
  }
  try {
    // Guard the parse: a 200 response can still be HTML (a redirected landing /
    // error page), which must degrade to "no membership", not crash the pass.
    return (await res.json()) as TokenListDoc;
  } catch {
    console.warn(`[tokenlist ${url}] non-JSON response — skipping this list`);
    return null;
  }
};

type CachedList = { keys: Set<string>; fetchedAt: number };
const cache = new Map<string, CachedList>();

async function listKeys(url: string, fetcher: ListFetcher, now: number): Promise<Set<string>> {
  const cached = cache.get(url);
  if (cached && now - cached.fetchedAt < LIST_TTL_MS) {
    return cached.keys;
  }
  const doc = await fetcher(url);
  if (!doc) {
    // Keep any prior cache on a transient failure; otherwise an empty set.
    return cached?.keys ?? new Set<string>();
  }
  const keys = new Set<string>();
  for (const t of doc.tokens ?? []) {
    if (typeof t.chainId === "number" && typeof t.address === "string") {
      keys.add(memberKey(t.chainId, t.address));
    }
  }
  cache.set(url, { keys, fetchedAt: now });
  return keys;
}

// Names of the configured lists that contain (chainId, address). Fetcher + now
// are injectable for tests; in production the lists are fetched once and cached.
export async function tokenListMembership(
  chainId: number,
  address: string,
  opts: { fetcher?: ListFetcher; now?: number } = {},
): Promise<string[]> {
  const fetcher = opts.fetcher ?? defaultListFetcher;
  const now = opts.now ?? Date.now();
  const matched: string[] = [];
  for (const { name, url } of TOKEN_LISTS) {
    const keys = await listKeys(url, fetcher, now);
    if (keys.has(memberKey(chainId, address))) {
      matched.push(name);
    }
  }
  return matched;
}

// Pure: a token on ≥1 curated list confirms the tokenlist category.
export function tokenListSignal(matchedLists: string[]): IdentitySignal {
  const confirmed = matchedLists.length > 0;
  return {
    source: "tokenlist",
    category: "tokenlist",
    confirmed,
    detail: confirmed ? `listed in: ${matchedLists.join(", ")}` : "not on any configured token list",
  };
}

// Test seam: reset the in-process list cache between cases.
export const __clearTokenListCache = (): void => cache.clear();
