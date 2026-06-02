// Canonical pair identification — the core of the verdict engine (A.2).
//
// Two pairs are the SAME logical pair when their two tokens resolve to the
// same CoinGecko coin ids, regardless of chain or DEX. The canonical key is
// `min(cgId0, cgId1):max(cgId0, cgId1)` — order-independent so WETH-USDC and
// USDC-WETH (and the same pair on another DEX/chain) collapse to one key. That
// is how the cross-DEX / cross-chain sibling problem gets solved: a novel pair
// that shares a key with an already-verified sibling is very likely real.
//
// `coingeckoCoinId` is populated from GeckoTerminal's
// `/networks/{chain}/tokens/...` response (see import/refresh_data.js). A token
// with no coin id (empty string) cannot be keyed — canonicalKey returns null,
// and such pairs route to NeedsReview rather than auto-anything.

import { utils as web3Utils } from "web3";

import prisma from "./prisma";

// Minimal structural input — deliberately not PairProps/Prisma-shaped so the
// function stays pure and testable from any caller (ingest, cron, UI rescan).
export type TokenCgId = { coingeckoCoinId?: string | null };
export type PairCgIds = { token0?: TokenCgId | null; token1?: TokenCgId | null };

// Normalise a raw coin id to its comparison form: trimmed + lower-cased.
// CoinGecko ids are already lower-case hyphenated slugs (e.g. "usd-coin"),
// but defend against stray casing/whitespace from upstream.
const normaliseCgId = (id: string | null | undefined): string =>
  (id ?? "").trim().toLowerCase();

// The colon separator is safe: CoinGecko ids contain [a-z0-9-] but never ":".
const KEY_SEPARATOR = ":";

// Returns the order-independent canonical key for a pair, or null when either
// token lacks a CoinGecko coin id (so the pair cannot be canonically keyed).
export function canonicalKey(pair: PairCgIds): string | null {
  const a = normaliseCgId(pair.token0?.coingeckoCoinId);
  const b = normaliseCgId(pair.token1?.coingeckoCoinId);
  if (!a || !b) {
    return null;
  }
  return a <= b ? `${a}${KEY_SEPARATOR}${b}` : `${b}${KEY_SEPARATOR}${a}`;
}

// --- Canonical contract resolution (impostor tie-break, A.2) -------------
//
// When two tokens on the same chain share a CoinGecko coin id but have
// different contract addresses, the verdict engine must decide which is the
// real one. CoinGecko's /coins/{id} endpoint returns a `platforms` map
// (CG-asset-platform-id -> contract address); the token whose address matches
// CG's entry for that chain is canonical. Results are cached in the
// CanonicalAddress table (A.1) with a 30-day TTL so the rare conflict path
// doesn't hammer CoinGecko's free-tier rate limit.

// CoinGecko asset-platform id per GeckoTerminal-style chain key (the `chain`
// field stored on Pair/Token). null = the chain isn't indexed by CoinGecko
// (e.g. qom), so no canonical lookup is possible and the fence is skipped.
const CG_PLATFORM_BY_CHAIN: Record<string, string | null> = {
  eth: "ethereum",
  polygon_pos: "polygon-pos",
  bsc: "binance-smart-chain",
  xdai: "xdai",
  qom: null,
};

export const cgPlatformForChain = (chain: string): string | null =>
  CG_PLATFORM_BY_CHAIN[chain] ?? null;

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

// The platforms map from CoinGecko, keyed by CG asset-platform id. Injectable
// so the cache logic can be tested without a live CoinGecko call.
export type PlatformsFetcher = (cgId: string) => Promise<Record<string, string> | null>;

const defaultPlatformsFetcher: PlatformsFetcher = async (cgId) => {
  const url =
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(cgId)}` +
    `?localization=false&tickers=false&market_data=false` +
    `&community_data=false&developer_data=false&sparkline=false`;
  const res = await fetch(url);
  if (!res.ok) {
    return null;
  }
  const json = await res.json();
  return (json?.platforms as Record<string, string>) ?? null;
};

// Resolve the canonical (CoinGecko-blessed) contract address for a coin on a
// chain, or null when the chain isn't on CoinGecko / the coin has no contract
// there. Reads/refreshes the 30-day CanonicalAddress cache. A confirmed
// "no address" answer is cached as "" so repeated misses don't re-hit CG.
export async function fetchCanonicalContract(
  cgId: string,
  chain: string,
  opts: { now?: number; fetcher?: PlatformsFetcher } = {},
): Promise<string | null> {
  const platform = cgPlatformForChain(chain);
  if (!cgId || !platform) {
    return null;
  }

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const fetcher = opts.fetcher ?? defaultPlatformsFetcher;

  const cached = await prisma.canonicalAddress.findUnique({
    where: { coingeckoCoinId_chain: { coingeckoCoinId: cgId, chain } },
  });
  if (cached && now - cached.lastChecked < THIRTY_DAYS_SECONDS) {
    return cached.contractAddress || null;
  }

  const platforms = await fetcher(cgId);
  const raw = platforms?.[platform];
  const address = raw && web3Utils.isAddress(raw) ? web3Utils.toChecksumAddress(raw) : "";

  await prisma.canonicalAddress.upsert({
    where: { coingeckoCoinId_chain: { coingeckoCoinId: cgId, chain } },
    update: { contractAddress: address, lastChecked: now },
    create: { coingeckoCoinId: cgId, chain, contractAddress: address, lastChecked: now },
  });

  return address || null;
}
