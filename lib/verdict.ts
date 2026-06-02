// Verdict-engine fence functions (A.2).
//
// Each fence is a small, pure predicate over a single aspect of a pair: does it
// have enough liquidity, is it old enough, do its token addresses match the
// CoinGecko-canonical ones, etc. Keeping them pure (primitive in, Fence out)
// makes every one individually testable and lets the ingest pipeline, the
// weekly re-verify cron and the on-demand UI rescan all share the exact same
// logic (DRY — one implementation, three call sites).
//
// evaluatePair (C4) composes these: hard-fence failures short-circuit to
// AutoRejected, the rest combine by weight into a confidence score. The
// adjudication and the DB-backed checks (sibling lookup, canonical-contract
// fetch) live there, not here.

export type Fence = {
  ok: boolean;
  // The observed value and the threshold it was tested against — surfaced in
  // the verdict evidence so the operator can see *why* a pair was classified.
  observed: number | string;
  threshold: number | string;
  reason: string;
  // Contribution to the confidence score. A skipped fence (unknown input)
  // reports weight 0 so it neither helps nor hurts.
  weight: number;
};

// Default per-fence weights. Foundational identity checks (has-cg-id, address
// matches canonical) outweigh the quantitative gates. evaluatePair may override
// these; A.3 may later make them per-(chain, dex) tunable.
export const FENCE_WEIGHTS = {
  bothTokensHaveCgId: 3,
  tokenAddressesMatchCanonical: 3,
  dexFactoryMatchesCanonical: 2,
  meetsLiquidity: 2,
  meetsTxCount: 1,
  meetsAge: 1,
  decimalsLookSane: 1,
  cgPriceWithinTolerance: 2,
} as const;

const SECONDS_PER_HOUR = 3600;

// Case-insensitive address compare. Both sides are normally checksummed, but
// lower-casing is the robust comparison regardless of casing provenance.
const addressesEqual = (a: string, b: string): boolean =>
  a.length > 0 && b.length > 0 && a.toLowerCase() === b.toLowerCase();

// Both tokens must resolve to a non-empty CoinGecko coin id — the precondition
// for canonical keying. Foundational: a pair that fails this can't be
// auto-verified (routes to NeedsReview, not AutoRejected).
export function bothTokensHaveCgId(
  token0CgId: string | null | undefined,
  token1CgId: string | null | undefined,
  weight: number = FENCE_WEIGHTS.bothTokensHaveCgId,
): Fence {
  const present = [token0CgId, token1CgId].filter((id) => (id ?? "").trim().length > 0).length;
  const ok = present === 2;
  return {
    ok,
    observed: present,
    threshold: 2,
    reason: ok ? "both tokens have a CoinGecko coin id" : "one or both tokens lack a CoinGecko coin id",
    weight,
  };
}

export function meetsLiquidity(
  reserveUsd: number,
  minLiquidityUsd: number,
  weight: number = FENCE_WEIGHTS.meetsLiquidity,
): Fence {
  const ok = reserveUsd >= minLiquidityUsd;
  return {
    ok,
    observed: reserveUsd,
    threshold: minLiquidityUsd,
    reason: ok ? "liquidity meets threshold" : "liquidity below threshold",
    weight,
  };
}

export function meetsTxCount(
  txCount: number,
  minTxCount: number,
  weight: number = FENCE_WEIGHTS.meetsTxCount,
): Fence {
  const ok = txCount >= minTxCount;
  return {
    ok,
    observed: txCount,
    threshold: minTxCount,
    reason: ok ? "tx count meets threshold" : "tx count below threshold",
    weight,
  };
}

// Skips (ok, weight 0) when the deployment timestamp is unknown (null/0) —
// deploymentTimestamp is a cheap proxy seeded lazily, so absence is "don't
// know yet", not "brand new".
export function meetsAge(
  deploymentTimestamp: number | null | undefined,
  now: number,
  minAgeHours: number,
  weight: number = FENCE_WEIGHTS.meetsAge,
): Fence {
  if (!deploymentTimestamp || deploymentTimestamp <= 0) {
    return { ok: true, observed: "unknown", threshold: minAgeHours, reason: "token age unknown — skipped", weight: 0 };
  }
  const ageHours = (now - deploymentTimestamp) / SECONDS_PER_HOUR;
  const ok = ageHours >= minAgeHours;
  return {
    ok,
    observed: Math.round(ageHours),
    threshold: minAgeHours,
    reason: ok ? "token old enough" : "token younger than minimum age",
    weight,
  };
}

// Decimals outside the sane band look bogus. Note 0 is ambiguous — it can mean
// "unfetched" (schema default) rather than a genuine 0-decimal token; the
// caller decides whether to run this fence when decimals are known.
export function decimalsLookSane(
  decimals: number,
  minDecimals: number,
  maxDecimals: number,
  weight: number = FENCE_WEIGHTS.decimalsLookSane,
): Fence {
  const ok = decimals >= minDecimals && decimals <= maxDecimals;
  return {
    ok,
    observed: decimals,
    threshold: `${minDecimals}-${maxDecimals}`,
    reason: ok ? "decimals within sane range" : "decimals outside sane range",
    weight,
  };
}

// Cross-validates the CoinGecko-reported price against the DEX-derived price.
// Skips when either price is missing/zero (can't compute a deviation). The
// deviation is measured relative to the CoinGecko price (the reference).
export function cgPriceWithinTolerance(
  cgPrice: number,
  dexPrice: number,
  maxDeviationPercent: number,
  weight: number = FENCE_WEIGHTS.cgPriceWithinTolerance,
): Fence {
  if (!cgPrice || !dexPrice || cgPrice <= 0 || dexPrice <= 0) {
    return {
      ok: true,
      observed: "unavailable",
      threshold: maxDeviationPercent,
      reason: "CG/DEX price unavailable — skipped",
      weight: 0,
    };
  }
  const deviationPercent = (Math.abs(dexPrice - cgPrice) / cgPrice) * 100;
  const ok = deviationPercent <= maxDeviationPercent;
  return {
    ok,
    observed: Math.round(deviationPercent * 100) / 100,
    threshold: maxDeviationPercent,
    reason: ok ? "CG/DEX price within tolerance" : "CG/DEX price deviation exceeds tolerance",
    weight,
  };
}

// A token's contract address must match the CoinGecko-canonical address for its
// coin id on that chain — catches impostors that spoof a known symbol/coin id.
// Skips when the canonical address is unknown (CG had no entry, or the chain
// isn't on CG, or the lookup hasn't run).
export function tokenAddressesMatchCanonical(
  tokenAddress: string,
  canonicalAddress: string | null | undefined,
  weight: number = FENCE_WEIGHTS.tokenAddressesMatchCanonical,
): Fence {
  if (!canonicalAddress) {
    return {
      ok: true,
      observed: tokenAddress,
      threshold: "unknown",
      reason: "canonical address unknown — skipped",
      weight: 0,
    };
  }
  const ok = addressesEqual(tokenAddress, canonicalAddress);
  return {
    ok,
    observed: tokenAddress,
    threshold: canonicalAddress,
    reason: ok ? "token address matches canonical" : "token address does NOT match canonical (possible impostor)",
    weight,
  };
}

// A pair's deployed factory must match the canonical factory for its
// (chain, dex). Skips when either is unknown — the pair's on-chain factory is
// not stored yet (an RPC `factory()` read lands in the A.4.1 ingest), and
// canonicalFactoryAddress is empty for parked sources (e.g. qomswap).
export function dexFactoryMatchesCanonical(
  pairFactoryAddress: string | null | undefined,
  canonicalFactoryAddress: string | null | undefined,
  weight: number = FENCE_WEIGHTS.dexFactoryMatchesCanonical,
): Fence {
  if (!pairFactoryAddress || !canonicalFactoryAddress) {
    return {
      ok: true,
      observed: pairFactoryAddress ?? "unknown",
      threshold: canonicalFactoryAddress ?? "unknown",
      reason: "pair/canonical factory unknown — skipped",
      weight: 0,
    };
  }
  const ok = addressesEqual(pairFactoryAddress, canonicalFactoryAddress);
  return {
    ok,
    observed: pairFactoryAddress,
    threshold: canonicalFactoryAddress,
    reason: ok ? "factory matches canonical" : "factory does NOT match canonical",
    weight,
  };
}
