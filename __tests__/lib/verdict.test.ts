// Tests for lib/verdict.ts fence functions (A.2). Each fence is pure, so these
// are plain unit tests covering pass / fail / skip (unknown-input) paths.

import { describe, expect, it } from "vitest";

import {
  bothTokensHaveCgId,
  bothTokensIdentified,
  cgPriceWithinTolerance,
  decimalsLookSane,
  DEFAULT_VERDICT_CONFIG,
  dexFactoryMatchesCanonical,
  evaluatePair,
  meetsAge,
  meetsLiquidity,
  meetsTurnover,
  meetsTxCount,
  tokenAddressesMatchCanonical,
  VERDICT_REASON,
  VerdictContext,
  VerdictPairInput,
  VerdictTokenInput,
} from "../../lib/verdict";
import { TokenPairStatus } from "../../types/types";

const NOW = 1_700_000_000;
const HOUR = 3600;

describe("bothTokensHaveCgId", () => {
  it("passes when both tokens have a coin id", () => {
    expect(bothTokensHaveCgId("weth", "usd-coin").ok).toBe(true);
  });

  it("fails when one is empty/null and reports the count", () => {
    const f = bothTokensHaveCgId("weth", "");
    expect(f.ok).toBe(false);
    expect(f.observed).toBe(1);
    expect(bothTokensHaveCgId(null, "usd-coin").ok).toBe(false);
  });

  it("treats whitespace-only ids as missing", () => {
    expect(bothTokensHaveCgId("  ", "usd-coin").ok).toBe(false);
  });
});

describe("bothTokensIdentified", () => {
  const tok = (cgId: string | null, identityConfirmed: boolean) => ({ cgId, identityConfirmed });

  it("passes when both tokens have a CoinGecko id (cgId path)", () => {
    expect(bothTokensIdentified(tok("weth", false), tok("usd-coin", false)).ok).toBe(true);
  });

  it("passes when a no-cgId token is independently identity-confirmed", () => {
    expect(bothTokensIdentified(tok("", true), tok("usd-coin", false)).ok).toBe(true);
    expect(bothTokensIdentified(tok(null, true), tok(null, true)).ok).toBe(true);
  });

  it("fails when a token is neither CG-listed nor identity-confirmed", () => {
    const f = bothTokensIdentified(tok("", false), tok("usd-coin", false));
    expect(f.ok).toBe(false);
    expect(f.observed).toBe(1);
    expect(f.reason).toMatch(/identity-confirmed/i);
  });

  it("is equivalent to bothTokensHaveCgId when no identity source has run", () => {
    // Behaviour-preservation: identityConfirmed=false everywhere ⇒ same gate.
    for (const [a, b] of [["weth", "usd-coin"], ["weth", ""], ["", ""]] as [string, string][]) {
      expect(bothTokensIdentified(tok(a, false), tok(b, false)).ok).toBe(bothTokensHaveCgId(a, b).ok);
    }
  });
});

describe("meetsLiquidity / meetsTxCount", () => {
  it("passes at or above threshold (inclusive)", () => {
    expect(meetsLiquidity(1000, 1000).ok).toBe(true);
    expect(meetsTxCount(50, 10).ok).toBe(true);
  });

  it("fails below threshold and echoes observed/threshold", () => {
    const f = meetsLiquidity(999, 1000);
    expect(f.ok).toBe(false);
    expect(f.observed).toBe(999);
    expect(f.threshold).toBe(1000);
    expect(meetsTxCount(5, 10).ok).toBe(false);
  });
});

describe("meetsTurnover", () => {
  it("passes when 24h turnover meets the ratio", () => {
    // volume 600k / liquidity 1M = 0.6 turnover, threshold 0.5.
    const f = meetsTurnover(600_000, 1_000_000, 0.5);
    expect(f.ok).toBe(true);
    expect(f.observed).toBe(0.6);
  });

  it("fails when turnover is below the ratio (low activity)", () => {
    const f = meetsTurnover(50_000, 1_000_000, 0.5); // 0.05 turnover
    expect(f.ok).toBe(false);
    expect(f.reason).toMatch(/low activity/i);
  });

  it("skips (weight 0) when volume or liquidity is zero", () => {
    expect(meetsTurnover(0, 1_000_000, 0.5).weight).toBe(0);
    expect(meetsTurnover(500_000, 0, 0.5).weight).toBe(0);
    expect(meetsTurnover(0, 1_000_000, 0.5).ok).toBe(true);
  });
});

describe("meetsAge", () => {
  it("passes when the token is older than the minimum", () => {
    const f = meetsAge(NOW - 48 * HOUR, NOW, 24);
    expect(f.ok).toBe(true);
    expect(f.observed).toBe(48);
    expect(f.weight).toBeGreaterThan(0);
  });

  it("fails when the token is younger than the minimum", () => {
    expect(meetsAge(NOW - 1 * HOUR, NOW, 24).ok).toBe(false);
  });

  it("skips (ok, weight 0) when the deployment timestamp is unknown", () => {
    for (const ts of [null, undefined, 0]) {
      const f = meetsAge(ts, NOW, 24);
      expect(f.ok).toBe(true);
      expect(f.weight).toBe(0);
      expect(f.observed).toBe("unknown");
    }
  });
});

describe("decimalsLookSane", () => {
  it("passes inside the band (inclusive)", () => {
    expect(decimalsLookSane(18, 2, 24).ok).toBe(true);
    expect(decimalsLookSane(2, 2, 24).ok).toBe(true);
  });

  it("fails below or above the band", () => {
    expect(decimalsLookSane(0, 2, 24).ok).toBe(false);
    expect(decimalsLookSane(40, 2, 24).ok).toBe(false);
  });
});

describe("cgPriceWithinTolerance", () => {
  it("passes when deviation is within tolerance", () => {
    // dex 102 vs cg 100 = 2% deviation, tolerance 5%.
    const f = cgPriceWithinTolerance(100, 102, 5);
    expect(f.ok).toBe(true);
    expect(f.observed).toBe(2);
  });

  it("fails when deviation exceeds tolerance", () => {
    // dex 110 vs cg 100 = 10% deviation, tolerance 5%.
    const f = cgPriceWithinTolerance(100, 110, 5);
    expect(f.ok).toBe(false);
    expect(f.observed).toBe(10);
  });

  it("skips when either price is missing/zero", () => {
    expect(cgPriceWithinTolerance(0, 100, 5).weight).toBe(0);
    expect(cgPriceWithinTolerance(100, 0, 5).weight).toBe(0);
    expect(cgPriceWithinTolerance(0, 100, 5).ok).toBe(true);
  });
});

describe("tokenAddressesMatchCanonical", () => {
  const A = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

  it("passes on a case-insensitive match", () => {
    expect(tokenAddressesMatchCanonical(A.toLowerCase(), A).ok).toBe(true);
  });

  it("fails (impostor) on mismatch", () => {
    const f = tokenAddressesMatchCanonical("0x0000000000000000000000000000000000000001", A);
    expect(f.ok).toBe(false);
    expect(f.reason).toMatch(/impostor/i);
    expect(f.weight).toBeGreaterThan(0);
  });

  it("skips (ok, weight 0) when the canonical address is unknown", () => {
    for (const canon of [null, undefined, ""]) {
      const f = tokenAddressesMatchCanonical(A, canon);
      expect(f.ok).toBe(true);
      expect(f.weight).toBe(0);
    }
  });
});

describe("dexFactoryMatchesCanonical", () => {
  const F = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";

  it("passes on a case-insensitive match", () => {
    expect(dexFactoryMatchesCanonical(F.toLowerCase(), F).ok).toBe(true);
  });

  it("fails on mismatch", () => {
    expect(
      dexFactoryMatchesCanonical("0x0000000000000000000000000000000000000002", F).ok,
    ).toBe(false);
  });

  it("skips when the pair factory or canonical factory is unknown", () => {
    expect(dexFactoryMatchesCanonical(null, F).weight).toBe(0);
    expect(dexFactoryMatchesCanonical(F, "").weight).toBe(0);
    expect(dexFactoryMatchesCanonical(null, F).ok).toBe(true);
  });
});

// --- evaluatePair golden cases ------------------------------------------

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const UNI_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";

const makeToken = (over: Partial<VerdictTokenInput> = {}): VerdictTokenInput => ({
  contractAddress: WETH,
  coingeckoCoinId: "weth",
  decimals: 18,
  deploymentTimestamp: NOW - 1000 * HOUR,
  priceCg: 2000,
  priceDex: 2000,
  canonicalAddress: WETH,
  identityConfirmed: false,
  ...over,
});

// A clean, clearly-real pair: both tokens have CG ids, addresses match the
// canonical ones, prices aligned, deep liquidity, old, sane decimals.
const makePair = (over: Partial<VerdictPairInput> = {}): VerdictPairInput => ({
  chain: "eth",
  dex: "uniswap_v3",
  reserveUsd: 1_000_000,
  volumeUsd: 500_000,
  txCount: 5000,
  token0: makeToken(),
  token1: makeToken({ contractAddress: USDC, coingeckoCoinId: "usd-coin", decimals: 6, priceCg: 1, priceDex: 1, canonicalAddress: USDC }),
  ...over,
});

const makeCtx = (over: Partial<VerdictContext> = {}): VerdictContext => ({
  now: NOW,
  config: DEFAULT_VERDICT_CONFIG,
  canonicalKey: "usd-coin:weth",
  hasVerifiedSibling: false,
  intraChainImpostorLoser: false,
  tokenScamFlagged: false,
  pairFactoryAddress: null,
  canonicalFactoryAddress: UNI_V3_FACTORY,
  firstParty: false,
  ...over,
});

describe("evaluatePair", () => {
  it("auto-verifies a clean novel pair on fences alone (confidence 1.0)", () => {
    const r = evaluatePair(makePair(), makeCtx());
    expect(r.verdict).toBe(TokenPairStatus.AutoVerified);
    expect(r.confidence).toBe(1);
    expect(r.canonicalKey).toBe("usd-coin:weth");
  });

  it("routes an IDENTIFIED phantom-liquidity pool (deep reserve, ~0 turnover) to review", () => {
    // Otherwise-clean pair (would auto-verify) but $1M reserve with $7 volume —
    // turnover ~7e-6 ⇒ the reserveUsd is a phantom. Withhold the credit + review.
    const r = evaluatePair(makePair({ volumeUsd: 7 }), makeCtx());
    expect(r.verdict).toBe(TokenPairStatus.NeedsReview);
    expect(r.reasonCode).toBe(VERDICT_REASON.phantomLiquidity);
    expect(r.evidence.phantomLiquidity).toBe(true);
  });

  it("auto-rejects an UNIDENTIFIED phantom-liquidity pool via AV-2 (effective sub-floor)", () => {
    const cfg = { ...DEFAULT_VERDICT_CONFIG, minLiquidityUsd: 25000 };
    const pair = makePair({
      reserveUsd: 1_000_000, volumeUsd: 7, // deep-looking but ~0 turnover ⇒ phantom
      token0: makeToken({ coingeckoCoinId: null, identityConfirmed: false, canonicalAddress: null }),
      token1: makeToken({ contractAddress: USDC, coingeckoCoinId: null, identityConfirmed: false, canonicalAddress: null, decimals: 6, priceCg: 1, priceDex: 1 }),
    });
    const r = evaluatePair(pair, makeCtx({ config: cfg, canonicalKey: null }));
    expect(r.verdict).toBe(TokenPairStatus.AutoRejected);
    expect(r.reasonCode).toBe(VERDICT_REASON.unidentifiedThinPool);
  });

  it("first-party: trusts a deep but quiet (0-volume) reserve — NOT phantom (the FUND-WETH case)", () => {
    // Without firstParty this $1M/$0-volume pool is phantom → review; ours auto-verifies.
    expect(evaluatePair(makePair({ volumeUsd: 0 }), makeCtx()).reasonCode).toBe(VERDICT_REASON.phantomLiquidity);
    const r = evaluatePair(makePair({ volumeUsd: 0 }), makeCtx({ firstParty: true }));
    expect(r.verdict).toBe(TokenPairStatus.AutoVerified);
    expect(r.evidence.phantomLiquidity).toBe(false);
    expect(r.evidence.firstParty).toBe(true);
  });

  it("first-party: never hard-rejected below the hard liquidity floor", () => {
    const cfg = { ...DEFAULT_VERDICT_CONFIG, hardMinLiquidityUsd: 500 };
    const pair = makePair({ reserveUsd: 100 }); // below the $500 hard floor
    expect(evaluatePair(pair, makeCtx({ config: cfg })).verdict).toBe(TokenPairStatus.AutoRejected);
    expect(evaluatePair(pair, makeCtx({ config: cfg, firstParty: true })).verdict).not.toBe(TokenPairStatus.AutoRejected);
  });

  it("first-party: an unidentified counterparty in a thin pool goes to review, not AV-2 reject", () => {
    const cfg = { ...DEFAULT_VERDICT_CONFIG, minLiquidityUsd: 25000 };
    const pair = makePair({
      reserveUsd: 1000, volumeUsd: 500,
      token1: makeToken({ contractAddress: USDC, coingeckoCoinId: null, identityConfirmed: false, canonicalAddress: null, decimals: 6, priceCg: 1, priceDex: 1 }),
    });
    expect(evaluatePair(pair, makeCtx({ config: cfg, canonicalKey: null })).verdict).toBe(TokenPairStatus.AutoRejected);
    const r = evaluatePair(pair, makeCtx({ config: cfg, canonicalKey: null, firstParty: true }));
    expect(r.verdict).toBe(TokenPairStatus.NeedsReview);
    expect(r.reasonCode).toBe(VERDICT_REASON.notIdentified);
  });

  it("does NOT flag a quiet-but-active pool (turnover above the phantom floor)", () => {
    // $1M reserve, $200 volume ⇒ turnover 2e-4 > 1e-4 floor — not phantom.
    const r = evaluatePair(makePair({ volumeUsd: 200 }), makeCtx());
    expect(r.verdict).toBe(TokenPairStatus.AutoVerified);
  });

  it("AV-1: auto-verifies a canonical-confirmed pair that misses only a soft liquidity gate", () => {
    // Real tokens (identity + both canonical addresses matched) in a thin pool
    // below the soft floor — verifiably real, so auto-verify with a GRADUATED
    // confidence (< 1.0) rather than parking. The thin-pool risk is go-ooo's to
    // weight downstream.
    const cfg = { ...DEFAULT_VERDICT_CONFIG, minLiquidityUsd: 25000 };
    const r = evaluatePair(makePair({ reserveUsd: 18000 }), makeCtx({ config: cfg }));
    expect(r.verdict).toBe(TokenPairStatus.AutoVerified);
    expect(r.reasonCode).toBe(VERDICT_REASON.canonicalConfirmed);
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
    expect(r.confidence).toBeLessThan(1); // graduated, not saturated (fixes Finding B)
  });

  it("AV-1: a high-confidence pair WITHOUT affirmed canonical addresses still needs the soft gates", () => {
    // canonical unknown on both tokens (fence skips, weight 0) → no impostor
    // confirmation → no AV-1 fast-path → stays in review despite high confidence.
    const cfg = { ...DEFAULT_VERDICT_CONFIG, minLiquidityUsd: 25000 };
    const pair = makePair({
      reserveUsd: 18000,
      token0: makeToken({ canonicalAddress: null }),
      token1: makeToken({ contractAddress: USDC, coingeckoCoinId: "usd-coin", decimals: 6, priceCg: 1, priceDex: 1, canonicalAddress: null }),
    });
    const r = evaluatePair(pair, makeCtx({ config: cfg }));
    expect(r.verdict).toBe(TokenPairStatus.NeedsReview);
  });

  it("AV-1: a canonical-confirmed pair below the confidence band still stays in review", () => {
    // Fails liquidity + tx-count + BOTH age gates → confidence < 0.85 → the band
    // still gates: too many soft misses keeps even a canonical-confirmed pair out.
    const cfg = { ...DEFAULT_VERDICT_CONFIG, minLiquidityUsd: 25000, minTxCount: 100 };
    const pair = makePair({
      reserveUsd: 18000,
      txCount: 5,
      token0: makeToken({ deploymentTimestamp: NOW }),
      token1: makeToken({ contractAddress: USDC, coingeckoCoinId: "usd-coin", decimals: 6, priceCg: 1, priceDex: 1, canonicalAddress: USDC, deploymentTimestamp: NOW }),
    });
    const r = evaluatePair(pair, makeCtx({ config: cfg }));
    expect(r.confidence).toBeLessThan(0.85);
    expect(r.verdict).toBe(TokenPairStatus.NeedsReview);
  });

  it("auto-verifies when a verified cross-source sibling shares the key", () => {
    // Drop confidence below the band by deviating one price, but the sibling
    // vouches (and liquidity passes) so it still auto-verifies.
    const pair = makePair({ token0: makeToken({ priceDex: 2400 }) }); // 20% deviation
    const r = evaluatePair(pair, makeCtx({ hasVerifiedSibling: true }));
    expect(r.verdict).toBe(TokenPairStatus.AutoVerified);
    expect(r.reason).toMatch(/sibling/i);
  });

  it("T3: routes an impostor token0 (address != canonical) to NeedsReview", () => {
    const pair = makePair({ token0: makeToken({ contractAddress: "0x0000000000000000000000000000000000000bad" }) });
    const r = evaluatePair(pair, makeCtx());
    expect(r.verdict).toBe(TokenPairStatus.NeedsReview);
    expect(r.reason).toMatch(/impostor/i);
    // Lock the structured code the triage + canonical-pass counter depend on.
    expect(r.reasonCode).toBe(VERDICT_REASON.canonicalImpostor);
  });

  it("T3: a matching canonical address does not block auto-verify", () => {
    // makeToken's contractAddress already equals its canonicalAddress (match).
    const r = evaluatePair(makePair(), makeCtx());
    expect(r.verdict).toBe(TokenPairStatus.AutoVerified);
    expect(r.evidence.token0MatchesCanonical).toBe(true);
  });

  it("auto-rejects below the hard liquidity floor", () => {
    const r = evaluatePair(makePair({ reserveUsd: 100 }), makeCtx());
    expect(r.verdict).toBe(TokenPairStatus.AutoRejected);
    expect(r.reason).toMatch(/liquidity/i);
  });

  it("auto-rejects absurd decimals but not zero (unfetched) decimals", () => {
    const absurd = evaluatePair(makePair({ token0: makeToken({ decimals: 99 }) }), makeCtx());
    expect(absurd.verdict).toBe(TokenPairStatus.AutoRejected);
    // decimals 0 is unfetched, not bogus — must NOT auto-reject on that alone.
    const zero = evaluatePair(makePair({ token0: makeToken({ decimals: 0 }) }), makeCtx());
    expect(zero.verdict).not.toBe(TokenPairStatus.AutoRejected);
  });

  it("marks the loser of an intra-chain impostor conflict NotCurrentlyUsable", () => {
    const r = evaluatePair(makePair(), makeCtx({ intraChainImpostorLoser: true }));
    expect(r.verdict).toBe(TokenPairStatus.NotCurrentlyUsable);
  });

  it("routes an unidentified token (no CG id, not identity-confirmed) to NeedsReview", () => {
    // DEFAULT config has no soft floor (minLiquidityUsd 0), so AV-2 doesn't fire.
    const pair = makePair({ token0: makeToken({ coingeckoCoinId: "", canonicalAddress: null }) });
    const r = evaluatePair(pair, makeCtx({ canonicalKey: null }));
    expect(r.verdict).toBe(TokenPairStatus.NeedsReview);
    expect(r.reason).toMatch(/identity-confirmed/i);
  });

  it("AV-2: auto-rejects an unidentified token in a sub-floor pool (not oracle-usable)", () => {
    const cfg = { ...DEFAULT_VERDICT_CONFIG, minLiquidityUsd: 25000 };
    const pair = makePair({
      reserveUsd: 18000, // above the hard floor, below the soft floor
      token0: makeToken({ coingeckoCoinId: "", identityConfirmed: false, canonicalAddress: null }),
    });
    const r = evaluatePair(pair, makeCtx({ config: cfg, canonicalKey: null }));
    expect(r.verdict).toBe(TokenPairStatus.AutoRejected);
    expect(r.reasonCode).toBe(VERDICT_REASON.unidentifiedThinPool);
  });

  it("AV-2: keeps a DEEP unidentified pool in review (may be real-but-unlisted → AV-3)", () => {
    const cfg = { ...DEFAULT_VERDICT_CONFIG, minLiquidityUsd: 25000 };
    const pair = makePair({
      reserveUsd: 150000, // above the soft floor — not auto-rejected
      token0: makeToken({ coingeckoCoinId: "", identityConfirmed: false, canonicalAddress: null }),
    });
    const r = evaluatePair(pair, makeCtx({ config: cfg, canonicalKey: null }));
    expect(r.verdict).toBe(TokenPairStatus.NeedsReview);
    expect(r.reasonCode).toBe(VERDICT_REASON.notIdentified);
  });

  it("T1: auto-verifies a no-CG-id pair when both tokens are identity-confirmed", () => {
    // Neither token is on CoinGecko, but ≥2 independent identity sources have
    // confirmed each (identityConfirmed=true) — the identity gate passes and the
    // pair clears on the remaining fences.
    const pair = makePair({
      token0: makeToken({ coingeckoCoinId: "", canonicalAddress: null, identityConfirmed: true }),
      token1: makeToken({
        contractAddress: USDC,
        coingeckoCoinId: "",
        decimals: 6,
        priceCg: 1,
        priceDex: 1,
        canonicalAddress: null,
        identityConfirmed: true,
      }),
    });
    const r = evaluatePair(pair, makeCtx({ canonicalKey: null }));
    expect(r.verdict).toBe(TokenPairStatus.AutoVerified);
  });

  it("T1: still reviews when only one of the two no-CG-id tokens is identity-confirmed", () => {
    const pair = makePair({
      token0: makeToken({ coingeckoCoinId: "", canonicalAddress: null, identityConfirmed: true }),
      token1: makeToken({
        contractAddress: USDC,
        coingeckoCoinId: "",
        decimals: 6,
        priceCg: 1,
        priceDex: 1,
        canonicalAddress: null,
        identityConfirmed: false,
      }),
    });
    const r = evaluatePair(pair, makeCtx({ canonicalKey: null }));
    expect(r.verdict).toBe(TokenPairStatus.NeedsReview);
    expect(r.reason).toMatch(/identity-confirmed/i);
  });

  it("routes a price-deviating-but-not-impostor pair to NeedsReview", () => {
    // 20% price deviation drops confidence below the band; no hard fence fires.
    const pair = makePair({ token0: makeToken({ priceDex: 2400 }) });
    const r = evaluatePair(pair, makeCtx());
    // The mid-band rule routes a price mismatch to review even though overall
    // confidence is still high (the price fence is only one of many).
    expect(r.verdict).toBe(TokenPairStatus.NeedsReview);
    expect(r.reason).toMatch(/price deviation/i);
  });

  it("does not reject when canonical addresses are unknown (fence skipped)", () => {
    const pair = makePair({
      token0: makeToken({ canonicalAddress: null }),
      token1: makeToken({ contractAddress: USDC, coingeckoCoinId: "usd-coin", decimals: 6, priceCg: 1, priceDex: 1, canonicalAddress: null }),
    });
    const r = evaluatePair(pair, makeCtx());
    expect(r.verdict).not.toBe(TokenPairStatus.AutoRejected);
    expect(r.verdict).toBe(TokenPairStatus.AutoVerified); // still clean on the other fences
  });

  it("treats unknown token age as a skip, not a blocker", () => {
    const pair = makePair({
      token0: makeToken({ deploymentTimestamp: null }),
      token1: makeToken({ contractAddress: USDC, coingeckoCoinId: "usd-coin", decimals: 6, priceCg: 1, priceDex: 1, canonicalAddress: USDC, deploymentTimestamp: null }),
    });
    const r = evaluatePair(pair, makeCtx());
    expect(r.verdict).toBe(TokenPairStatus.AutoVerified);
  });

  it("T7: holds a dormant pool (tx-count below the floor) for review when canonical is unconfirmed", () => {
    // The tx-count gate still parks a pool that ISN'T canonical-confirmed — AV-1
    // only bypasses the soft gates for verifiably-real, canonical-matched pairs.
    // (A canonical-confirmed dormant pool now auto-verifies — see the AV-1 tests.)
    const cfg = { ...DEFAULT_VERDICT_CONFIG, minTxCount: 10 };
    const pair = makePair({
      txCount: 2,
      token0: makeToken({ canonicalAddress: null }),
      token1: makeToken({ contractAddress: USDC, coingeckoCoinId: "usd-coin", decimals: 6, priceCg: 1, priceDex: 1, canonicalAddress: null }),
    });
    const r = evaluatePair(pair, makeCtx({ config: cfg }));
    expect(r.verdict).toBe(TokenPairStatus.NeedsReview);
  });

  it("holds a too-young, canonically-unconfirmed pair for review when the age gate fails", () => {
    const cfg = { ...DEFAULT_VERDICT_CONFIG, minAgeHours: 720 }; // 30 days
    const pair = makePair({
      token0: makeToken({ deploymentTimestamp: NOW - 1 * HOUR, canonicalAddress: null }),
      token1: makeToken({ contractAddress: USDC, coingeckoCoinId: "usd-coin", decimals: 6, priceCg: 1, priceDex: 1, canonicalAddress: null }),
    });
    const r = evaluatePair(pair, makeCtx({ config: cfg }));
    expect(r.verdict).toBe(TokenPairStatus.NeedsReview);
  });

  it("T2: routes a factory mismatch to NeedsReview (not auto-reject)", () => {
    // Pool's on-chain factory differs from the canonical uniswap_v3 factory.
    const r = evaluatePair(makePair(), makeCtx({ pairFactoryAddress: "0x000000000000000000000000000000000000fac7" }));
    expect(r.verdict).toBe(TokenPairStatus.NeedsReview);
    expect(r.reason).toMatch(/factory/i);
  });

  it("T2: auto-verifies when the on-chain factory matches the canonical factory", () => {
    const r = evaluatePair(makePair(), makeCtx({ pairFactoryAddress: UNI_V3_FACTORY }));
    expect(r.verdict).toBe(TokenPairStatus.AutoVerified);
    expect(r.confidence).toBe(1); // the factory fence now passes too
  });

  it("routes a scam-flagged token to NeedsReview, even with a verified sibling", () => {
    const r = evaluatePair(makePair(), makeCtx({ tokenScamFlagged: true, hasVerifiedSibling: true }));
    expect(r.verdict).toBe(TokenPairStatus.NeedsReview);
    expect(r.reason).toMatch(/scam/i);
  });

  it("surfaces the canonical key and confidence in the evidence", () => {
    const r = evaluatePair(makePair(), makeCtx());
    expect(r.evidence.canonicalKey).toBe("usd-coin:weth");
    expect(r.evidence.confidence).toBe(1);
    expect(r.evidence.token0MatchesCanonical).toBe(true);
  });
});
