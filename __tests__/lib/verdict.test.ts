// Tests for lib/verdict.ts fence functions (A.2). Each fence is pure, so these
// are plain unit tests covering pass / fail / skip (unknown-input) paths.

import { describe, expect, it } from "vitest";

import {
  bothTokensHaveCgId,
  cgPriceWithinTolerance,
  decimalsLookSane,
  DEFAULT_VERDICT_CONFIG,
  dexFactoryMatchesCanonical,
  evaluatePair,
  meetsAge,
  meetsLiquidity,
  meetsTxCount,
  tokenAddressesMatchCanonical,
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
  ...over,
});

// A clean, clearly-real pair: both tokens have CG ids, addresses match the
// canonical ones, prices aligned, deep liquidity, old, sane decimals.
const makePair = (over: Partial<VerdictPairInput> = {}): VerdictPairInput => ({
  chain: "eth",
  dex: "uniswap_v3",
  reserveUsd: 1_000_000,
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
  ...over,
});

describe("evaluatePair", () => {
  it("auto-verifies a clean novel pair on fences alone (confidence 1.0)", () => {
    const r = evaluatePair(makePair(), makeCtx());
    expect(r.verdict).toBe(TokenPairStatus.AutoVerified);
    expect(r.confidence).toBe(1);
    expect(r.canonicalKey).toBe("usd-coin:weth");
  });

  it("auto-verifies when a verified cross-source sibling shares the key", () => {
    // Drop confidence below the band by deviating one price, but the sibling
    // vouches (and liquidity passes) so it still auto-verifies.
    const pair = makePair({ token0: makeToken({ priceDex: 2400 }) }); // 20% deviation
    const r = evaluatePair(pair, makeCtx({ hasVerifiedSibling: true }));
    expect(r.verdict).toBe(TokenPairStatus.AutoVerified);
    expect(r.reason).toMatch(/sibling/i);
  });

  it("auto-rejects an impostor token0 (address != canonical)", () => {
    const pair = makePair({ token0: makeToken({ contractAddress: "0x0000000000000000000000000000000000000bad" }) });
    const r = evaluatePair(pair, makeCtx());
    expect(r.verdict).toBe(TokenPairStatus.AutoRejected);
    expect(r.reason).toMatch(/impostor/i);
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

  it("routes a token with no CG id to NeedsReview (legit-new vs scam)", () => {
    const pair = makePair({ token0: makeToken({ coingeckoCoinId: "", canonicalAddress: null }) });
    const r = evaluatePair(pair, makeCtx({ canonicalKey: null }));
    expect(r.verdict).toBe(TokenPairStatus.NeedsReview);
    expect(r.reason).toMatch(/coingecko coin id/i);
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

  it("holds a too-young pair for review when age gate fails", () => {
    const cfg = { ...DEFAULT_VERDICT_CONFIG, minAgeHours: 720 }; // 30 days
    const pair = makePair({
      token0: makeToken({ deploymentTimestamp: NOW - 1 * HOUR }),
    });
    const r = evaluatePair(pair, makeCtx({ config: cfg }));
    expect(r.verdict).toBe(TokenPairStatus.NeedsReview);
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
