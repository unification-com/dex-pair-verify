// Verdict-engine fences + adjudication (A.2).
//
// Each fence is a small, pure predicate over a single aspect of a pair: does it
// have enough liquidity, is it old enough, do its token addresses match the
// CoinGecko-canonical ones, etc. Keeping them pure (primitive in, Fence out)
// makes every one individually testable and lets the ingest pipeline, the
// weekly re-verify cron and the on-demand UI rescan all share the exact same
// logic (DRY — one implementation, three call sites).
//
// evaluatePair composes these: hard-fence failures short-circuit to
// AutoRejected, the rest combine by weight into a confidence score. The
// DB-backed inputs it needs (the precomputed canonical key, whether a verified
// sibling shares that key, whether this pair lost an intra-chain impostor
// conflict, each token's canonical address) are gathered by the caller into a
// VerdictContext — so the adjudication itself stays pure and unit-testable, and
// the DB context-builder lives at the call sites (the A.4.1 ingest, the
// re-verify cron, the UI rescan).

import { isPhantomLiquidity } from "./phantomLiquidity";
import { TokenPairStatus } from "../types/types";

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
  bothTokensIdentified: 3,
  tokenAddressesMatchCanonical: 3,
  dexFactoryMatchesCanonical: 2,
  meetsLiquidity: 2,
  meetsTxCount: 1,
  meetsTurnover: 1,
  meetsAge: 1,
  decimalsLookSane: 1,
  cgPriceWithinTolerance: 2,
} as const;

const SECONDS_PER_HOUR = 3600;

// Case-insensitive address compare. Both sides are normally checksummed, but
// lower-casing is the robust comparison regardless of casing provenance.
const addressesEqual = (a: string, b: string): boolean =>
  a.length > 0 && b.length > 0 && a.toLowerCase() === b.toLowerCase();

// A token is "known to CoinGecko" when it has a non-empty coin id. cgId is still
// the precondition for canonical keying (cross-source sibling detection), so this
// primitive is retained even though the adjudication gate is now the broader
// bothTokensIdentified below.
export const hasCgId = (cgId: string | null | undefined): boolean => (cgId ?? "").trim().length > 0;

// A token is "identified" when CoinGecko lists it OR ≥2 independent identity
// sources confirmed it (Phase 5 T1). identityConfirmed is resolved off the hot
// path in the context builder and arrives here as a pure boolean.
export const tokenIdentified = (cgId: string | null | undefined, identityConfirmed: boolean): boolean =>
  hasCgId(cgId) || identityConfirmed;

// Both tokens must resolve to a non-empty CoinGecko coin id — the precondition
// for canonical keying.
export function bothTokensHaveCgId(
  token0CgId: string | null | undefined,
  token1CgId: string | null | undefined,
  weight: number = FENCE_WEIGHTS.bothTokensHaveCgId,
): Fence {
  const present = [token0CgId, token1CgId].filter(hasCgId).length;
  const ok = present === 2;
  return {
    ok,
    observed: present,
    threshold: 2,
    reason: ok ? "both tokens have a CoinGecko coin id" : "one or both tokens lack a CoinGecko coin id",
    weight,
  };
}

// Foundational identity gate: both tokens must be *identifiable* — CoinGecko-
// listed OR independently identity-confirmed (T1). A pair that fails this can't
// be auto-verified (routes to NeedsReview, not AutoRejected — a legit-new token
// no source recognises yet is the operator's call, not a reject). When no
// identity source has run (identityConfirmed = false everywhere) this is exactly
// equivalent to bothTokensHaveCgId, so it's behaviour-preserving until T1's
// sources land.
export function bothTokensIdentified(
  token0: { cgId: string | null | undefined; identityConfirmed: boolean },
  token1: { cgId: string | null | undefined; identityConfirmed: boolean },
  weight: number = FENCE_WEIGHTS.bothTokensIdentified,
): Fence {
  const identified = [token0, token1].filter((t) => tokenIdentified(t.cgId, t.identityConfirmed)).length;
  const ok = identified === 2;
  return {
    ok,
    observed: identified,
    threshold: 2,
    reason: ok
      ? "both tokens identified (CoinGecko or ≥2 independent sources)"
      : "one or both tokens are neither CoinGecko-listed nor independently identity-confirmed",
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

// 24h turnover (volume ÷ liquidity) — the second activity axis (T7). A deep pool
// with little volume relative to its size has a stale, less reliable price.
// Skips (ok, weight 0) when liquidity or volume is zero/unknown (can't compute).
// minTurnoverRatio 0 ⇒ always ok for an active pool (the lever is off by default).
export function meetsTurnover(
  volumeUsd: number,
  reserveUsd: number,
  minTurnoverRatio: number,
  weight: number = FENCE_WEIGHTS.meetsTurnover,
): Fence {
  if (reserveUsd <= 0 || volumeUsd <= 0) {
    return { ok: true, observed: "unavailable", threshold: minTurnoverRatio, reason: "turnover unavailable — skipped", weight: 0 };
  }
  const turnover = volumeUsd / reserveUsd;
  const ok = turnover >= minTurnoverRatio;
  return {
    ok,
    observed: Math.round(turnover * 1e4) / 1e4,
    threshold: minTurnoverRatio,
    reason: ok ? "turnover meets threshold" : "turnover below threshold (low activity)",
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

// --- Adjudication --------------------------------------------------------

// Tunable knobs. Liquidity + tx-count come from the Threshold table today; the
// rest are constants here until A.3 grows the Threshold table to hold them
// per-(chain, dex). All are surfaced so a caller can override per source.
export type VerdictConfig = {
  minLiquidityUsd: number; // soft gate (Threshold.minLiquidityUsd)
  minTxCount: number; // soft gate (Threshold.minTxCount)
  minTurnoverRatio: number; // weighted activity signal (Threshold.minTurnoverRatio)
  minAgeHours: number;
  maxPriceDeviationPercent: number;
  minDecimals: number;
  maxDecimals: number;
  hardMinLiquidityUsd: number; // below this is an auto-reject, regardless of score
  autoVerifyConfidence: number; // confidence band for auto-verify
};

export const DEFAULT_VERDICT_CONFIG: VerdictConfig = {
  minLiquidityUsd: 0, // operator tightens per (chain, dex) via Threshold
  minTxCount: 0,
  minTurnoverRatio: 0,
  minAgeHours: 24,
  maxPriceDeviationPercent: 5,
  minDecimals: 0, // 0 passes (unfetched); only absurdly high decimals reject
  maxDecimals: 36,
  hardMinLiquidityUsd: 500,
  autoVerifyConfidence: 0.85,
};

export type VerdictTokenInput = {
  contractAddress: string;
  coingeckoCoinId: string | null;
  decimals: number;
  deploymentTimestamp: number | null;
  priceCg: number; // this token's CoinGecko price (Pair.token{0,1}PriceCg)
  priceDex: number; // this token's DEX price (Pair.token{0,1}PriceDex)
  canonicalAddress: string | null; // from fetchCanonicalContract, or null/unknown
  identityConfirmed: boolean; // T1: ≥2 independent identity sources agree (resolved in the context builder)
};

export type VerdictPairInput = {
  chain: string;
  dex: string;
  reserveUsd: number;
  volumeUsd: number; // 24h volume — feeds the turnover fence (T7)
  txCount: number;
  token0: VerdictTokenInput;
  token1: VerdictTokenInput;
};

export type VerdictContext = {
  now: number;
  config: VerdictConfig;
  // Precomputed by the caller via canonicalKey() — kept out of evaluatePair so
  // this module needn't import the prisma-backed canonical.ts.
  canonicalKey: string | null;
  // A ManualVerified/AutoVerified pair on a different (chain, dex) shares this
  // canonical key — a strong "this is real" signal (cross-source sibling).
  hasVerifiedSibling: boolean;
  // This pair lost an intra-(chain, dex) impostor conflict: another pair with
  // the same canonical key on the same (chain, dex) matches the canonical token
  // addresses and this one doesn't.
  intraChainImpostorLoser: boolean;
  // Either token is flagged by the scam-list (GoPlus, A.7) — route to review.
  tokenScamFlagged: boolean;
  // A Uniswap-v4 pool with a non-zero hooks contract — its price can be non-canonical /
  // manipulable, so it never auto-verifies; route to review until hooks are allow-listed.
  hookedPool: boolean;
  pairFactoryAddress: string | null; // unknown until A.4.1 RPC read
  canonicalFactoryAddress: string | null; // from lib/sources.js
  // Either token is one of OUR own tokens (FUND/xFUND/FUNDx — lib/firstParty.ts).
  // First-party pairs are never auto-rejected and their reserve is trusted (no
  // phantom guard) — we always want a feed for our token; the deep ones
  // auto-verify, the thin ones route to review for manual inclusion.
  firstParty: boolean;
};

// Stable machine-readable code for each adjudication outcome — one per branch of
// evaluatePair. Consumers (review triage, the canonical-pass impostor counter)
// switch on this instead of substring-matching the human `reason` prose, which
// silently breaks when the wording changes. One canonical list referenced
// everywhere (DRY) and type-checked — a typo is a compile error, not a silent
// miss.
export const VERDICT_REASON = {
  intraChainImpostorLoser: "intraChainImpostorLoser",
  liquidityBelowHardFloor: "liquidityBelowHardFloor",
  phantomLiquidity: "phantomLiquidity",
  decimalsBogus: "decimalsBogus",
  notIdentified: "notIdentified",
  unidentifiedThinPool: "unidentifiedThinPool",
  scamFlagged: "scamFlagged",
  hookedPool: "hookedPool",
  factoryMismatch: "factoryMismatch",
  canonicalImpostor: "canonicalImpostor",
  siblingVouched: "siblingVouched",
  priceDeviation: "priceDeviation",
  highConfidence: "highConfidence",
  canonicalConfirmed: "canonicalConfirmed",
  belowAutoVerifyBar: "belowAutoVerifyBar",
} as const;

export type VerdictReasonCode = (typeof VERDICT_REASON)[keyof typeof VERDICT_REASON];

export type VerdictResult = {
  verdict: TokenPairStatus;
  reason: string;
  // Machine-readable tag for the branch that produced this verdict (see
  // VERDICT_REASON). Stable across reason-wording changes — consumers switch on
  // this, never on the prose.
  reasonCode: VerdictReasonCode;
  evidence: Record<string, number | string | boolean>;
  canonicalKey: string | null;
  confidence: number;
};

// Combine fence outcomes into a confidence score in [0, 1]: the fraction of
// non-skipped weight that passed. Skipped fences (weight 0) drop out entirely.
const computeConfidence = (fences: Fence[]): number => {
  let total = 0;
  let passed = 0;
  for (const f of fences) {
    total += f.weight;
    if (f.ok) {
      passed += f.weight;
    }
  }
  return total === 0 ? 0 : passed / total;
};

// Run every fence against a pair and adjudicate a verdict. Pure: all external
// data arrives via ctx. The verdict-engine's single implementation, reused by
// ingest / cron / UI-rescan.
export function evaluatePair(pair: VerdictPairInput, ctx: VerdictContext): VerdictResult {
  const { config, now } = ctx;

  // Phantom liquidity: a deep-looking pool (reserve ≥ floor) whose 24h turnover is
  // near-zero reports a reserveUsd that isn't real (it's derived from a garbage
  // token price). Withhold its liquidity for every liquidity-dependent decision —
  // so an UNIDENTIFIED phantom pool falls to AV-2 auto-reject (sub-floor), and an
  // identified one is routed to review at step 5b below.
  // First-party (OUR) tokens: trust the reserve absolutely (a quiet 24h on FUND
  // doesn't make its real pool a phantom), so the phantom guard is skipped.
  const phantomLiquidity = !ctx.firstParty && isPhantomLiquidity(pair.reserveUsd, pair.volumeUsd, config.minLiquidityUsd);
  const effectiveReserveUsd = phantomLiquidity ? 0 : pair.reserveUsd;

  const f = {
    identified: bothTokensIdentified(
      { cgId: pair.token0.coingeckoCoinId, identityConfirmed: pair.token0.identityConfirmed },
      { cgId: pair.token1.coingeckoCoinId, identityConfirmed: pair.token1.identityConfirmed },
    ),
    liquidity: meetsLiquidity(effectiveReserveUsd, config.minLiquidityUsd),
    txCount: meetsTxCount(pair.txCount, config.minTxCount),
    turnover: meetsTurnover(pair.volumeUsd, pair.reserveUsd, config.minTurnoverRatio),
    age0: meetsAge(pair.token0.deploymentTimestamp, now, config.minAgeHours),
    age1: meetsAge(pair.token1.deploymentTimestamp, now, config.minAgeHours),
    decimals0: decimalsLookSane(pair.token0.decimals, config.minDecimals, config.maxDecimals),
    decimals1: decimalsLookSane(pair.token1.decimals, config.minDecimals, config.maxDecimals),
    price0: cgPriceWithinTolerance(pair.token0.priceCg, pair.token0.priceDex, config.maxPriceDeviationPercent),
    price1: cgPriceWithinTolerance(pair.token1.priceCg, pair.token1.priceDex, config.maxPriceDeviationPercent),
    canon0: tokenAddressesMatchCanonical(pair.token0.contractAddress, pair.token0.canonicalAddress),
    canon1: tokenAddressesMatchCanonical(pair.token1.contractAddress, pair.token1.canonicalAddress),
    factory: dexFactoryMatchesCanonical(ctx.pairFactoryAddress, ctx.canonicalFactoryAddress),
  };

  const allFences = Object.values(f);
  const confidence = computeConfidence(allFences);

  const evidence: Record<string, number | string | boolean> = {
    canonicalKey: ctx.canonicalKey ?? "none",
    confidence,
    reserveUsd: pair.reserveUsd,
    phantomLiquidity,
    firstParty: ctx.firstParty,
    txCount: pair.txCount,
    turnover: f.turnover.observed,
    hasVerifiedSibling: ctx.hasVerifiedSibling,
    token0MatchesCanonical: f.canon0.ok,
    token1MatchesCanonical: f.canon1.ok,
    token0PriceDeviation: f.price0.observed,
    token1PriceDeviation: f.price1.observed,
    token0Decimals: pair.token0.decimals,
    token1Decimals: pair.token1.decimals,
  };

  const result = (verdict: TokenPairStatus, reasonCode: VerdictReasonCode, reason: string): VerdictResult => ({
    verdict,
    reason,
    reasonCode,
    evidence,
    canonicalKey: ctx.canonicalKey,
    confidence,
  });

  // 1. Intra-(chain, dex) impostor conflict loser → NotCurrentlyUsable. Checked
  //    BEFORE the hard impostor fence: a loser definitionally doesn't match the
  //    canonical addresses, but because a *competing* canonical pair is present
  //    on this (chain, dex) we know it's a duplicate that lost — softer than the
  //    AutoRejected we give a lone impostor with no canonical competitor.
  if (ctx.intraChainImpostorLoser) {
    return result(
      TokenPairStatus.NotCurrentlyUsable,
      VERDICT_REASON.intraChainImpostorLoser,
      "another pair with this canonical key on this (chain, dex) matches the canonical token addresses",
    );
  }

  // 2. Hard fences — short-circuit to AutoRejected (bypasses operator review).
  //    A fence only fails (vs skips) when it had the data to fail on. First-party
  //    pairs are exempt — we never hard-reject our own token's pools (a thin one
  //    falls through to review below, not the bin).
  if (!ctx.firstParty && pair.reserveUsd < config.hardMinLiquidityUsd) {
    return result(
      TokenPairStatus.AutoRejected,
      VERDICT_REASON.liquidityBelowHardFloor,
      `liquidity below hard floor ($${config.hardMinLiquidityUsd})`,
    );
  }
  if (!f.decimals0.ok || !f.decimals1.ok) {
    return result(TokenPairStatus.AutoRejected, VERDICT_REASON.decimalsBogus, "token decimals look bogus");
  }

  // 3. A token that is neither CoinGecko-listed NOR independently identity-
  //    confirmed (T1). AV-2: if the pool is ALSO below the soft liquidity floor,
  //    it is neither cross-referenceable nor deep enough to price reliably — it
  //    can't serve the oracle, so auto-reject rather than queue it for manual
  //    review. A DEEPER unidentified pool (≥ floor) might be a real-but-unlisted
  //    token worth a look (AV-3), so it stays in review for the operator. This is
  //    reversible: a later cgId / identity-confirm + a re-validate re-evaluates it.
  if (!f.identified.ok) {
    if (!ctx.firstParty && effectiveReserveUsd < config.minLiquidityUsd) {
      return result(
        TokenPairStatus.AutoRejected,
        VERDICT_REASON.unidentifiedThinPool,
        phantomLiquidity
          ? "unidentified token in a phantom-liquidity pool (deep reserve, ~zero turnover) — not oracle-usable (AV-2)"
          : "unidentified token in a sub-floor pool — not oracle-usable (AV-2)",
      );
    }
    return result(TokenPairStatus.NeedsReview, VERDICT_REASON.notIdentified, f.identified.reason);
  }

  // 3b. A scam-list flag (A.7) blocks auto-verify outright — even a verified
  //     sibling can't vouch past it; the operator decides.
  if (ctx.tokenScamFlagged) {
    return result(TokenPairStatus.NeedsReview, VERDICT_REASON.scamFlagged, "a token is flagged by the scam-list");
  }

  // 3b-ii. A Uniswap-v4 hooked pool (non-zero hooks contract) never auto-verifies — its hooks can
  //        make the reported price non-canonical or manipulable, and anyone can spin one up. Route
  //        to review until the hooks address is allow-listed (the oracle hooks-safety policy).
  if (ctx.hookedPool) {
    return result(TokenPairStatus.NeedsReview, VERDICT_REASON.hookedPool, "a Uniswap v4 hooked pool — price not yet trusted (hooks not allow-listed)");
  }

  // 3c. Factory mismatch (T2): the pool's on-chain factory() does not match the
  //     canonical DEX factory — a possible impostor, OR a legit pool from the
  //     DEX's secondary factory. Ambiguous, so route to review rather than
  //     hard-reject (cf. the token-address impostor fence, which IS a reject).
  //     Skips when the factory is unknown (fence weight 0 ⇒ ok), so this is inert
  //     until the factory-check pass reads it.
  if (!f.factory.ok) {
    return result(TokenPairStatus.NeedsReview, VERDICT_REASON.factoryMismatch, f.factory.reason);
  }

  // 3d. Token-address impostor (T3): a token's contract address does not match
  //     the CoinGecko-canonical contract for its coin id. Routed to review (not
  //     auto-reject) — a mismatch is usually an impostor but can be a legit
  //     multi-contract/bridged variant CoinGecko maps differently, so the
  //     operator decides. Skips when the canonical address is unknown (cache
  //     miss), so this is inert until the canonical-check pass warms the cache.
  //     The harder intra-chain conflict loser is already caught at step 1.
  if (!f.canon0.ok || !f.canon1.ok) {
    return result(
      TokenPairStatus.NeedsReview,
      VERDICT_REASON.canonicalImpostor,
      "a token address does not match the CoinGecko-canonical contract (possible impostor)",
    );
  }

  // 4. A verified cross-source sibling vouches for the key (+ liquidity passes)
  //    — a strong enough signal to auto-verify even past the mid-band rule.
  if (ctx.hasVerifiedSibling && f.liquidity.ok) {
    return result(
      TokenPairStatus.AutoVerified,
      VERDICT_REASON.siblingVouched,
      "canonical key matches an already-verified cross-source sibling",
    );
  }

  // 5. Mid-band rule (A.3): a CG/DEX price mismatch is never auto-verified —
  //    it's not necessarily a scam, but it needs operator eyes.
  if (!f.price0.ok || !f.price1.ok) {
    return result(TokenPairStatus.NeedsReview, VERDICT_REASON.priceDeviation, "CG/DEX price deviation exceeds tolerance");
  }

  // 5b. Phantom liquidity: a deep-looking pool with near-zero 24h turnover — the
  //     reserveUsd is a phantom (garbage-price-derived), not real liquidity. Never
  //     auto-verify a dead/fake pool; route to review so the operator decides. An
  //     UNIDENTIFIED phantom pool was already AV-2 auto-rejected at step 3 (its
  //     effective reserve is withheld), so this catches the IDENTIFIED ones — incl.
  //     an otherwise-canonical-confirmed pair AV-1 would have waved through.
  if (phantomLiquidity) {
    return result(
      TokenPairStatus.NeedsReview,
      VERDICT_REASON.phantomLiquidity,
      "reserve looks deep but 24h turnover is near-zero — the liquidity figure is likely a phantom (dead/fake pool)",
    );
  }

  // 6. Auto-verify, once confidence clears the band, by either route:
  //    (a) the core quantitative gates (liquidity / tx-count / age) all pass — a
  //        clean, deep, mature pool; or
  //    (b) AV-1 — both tokens are AFFIRMATIVELY canonical-matched (identity +
  //        correct contract for the coin id, weight > 0 so the address was known,
  //        not skipped). Such a pair is verifiably REAL — not an impostor — so the
  //        remaining soft gates (liquidity / tx-count / age) are DEPTH/ACTIVITY
  //        quality, not legitimacy. Parking a verifiably-real pair for manual
  //        review adds little; the thin-pool price risk is handled DOWNSTREAM by
  //        go-ooo's liquidity-weighting + outlier rejection on the exported
  //        `confidence` (which here is graduated, < 1.0, carrying the soft-gate
  //        severity) and `reserveUsd`. A pair WITHOUT affirmed canonical addresses
  //        still needs the core gates — we won't auto-verify an unconfirmed pair.
  if (confidence >= config.autoVerifyConfidence) {
    const coreGatesPass = f.liquidity.ok && f.txCount.ok && f.age0.ok && f.age1.ok;
    const canonicalConfirmed = f.canon0.ok && f.canon0.weight > 0 && f.canon1.ok && f.canon1.weight > 0;
    if (coreGatesPass) {
      return result(TokenPairStatus.AutoVerified, VERDICT_REASON.highConfidence, "all fences passed with high confidence");
    }
    if (canonicalConfirmed) {
      return result(
        TokenPairStatus.AutoVerified,
        VERDICT_REASON.canonicalConfirmed,
        "verifiably real (identity + canonical address) but below the soft depth/activity bar — trust score reflects depth (AV-1)",
      );
    }
  }

  // 7. Everything else lands in the (shrunken) manual queue.
  return result(TokenPairStatus.NeedsReview, VERDICT_REASON.belowAutoVerifyBar, "meets some fences but not the auto-verify bar");
}
