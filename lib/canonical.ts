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
