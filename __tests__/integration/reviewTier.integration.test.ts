// Integration tests for the review-queue triage (T9) — computeReviewTier + the
// runVerdictForPair persistence. The symbol-spoof check hits the DB, so these
// are integration tests.

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, seedPair, seedToken, testPrisma } from "./helpers";
import { computeReviewTier } from "../../lib/reviewTier";
import { runVerdictForPair } from "../../lib/verdictRunner";
import { TokenPairStatus } from "../../types/types";

const NEEDS_REVIEW_REASON = "meets some fences but not the auto-verify bar";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("computeReviewTier", () => {
  const tok = (over: Partial<{ symbol: string; coingeckoCoinId: string; isScamFlagged: boolean }> = {}) => ({
    id: "t",
    chain: "eth",
    symbol: "AAA",
    coingeckoCoinId: "",
    isScamFlagged: false,
    ...over,
  });

  it("flags an impostor reason as spam", () => {
    expect(computeReviewTier("a token address does not match the canonical contract (possible impostor)", tok(), tok())).toBe("spam");
  });

  it("flags a scam-flagged token as spam", () => {
    expect(computeReviewTier(NEEDS_REVIEW_REASON, tok({ isScamFlagged: true }), tok())).toBe("spam");
  });

  it("flags a no-cgId token faking a MAJOR token (USDC/WETH) as spam, case-insensitively", () => {
    expect(computeReviewTier(NEEDS_REVIEW_REASON, tok({ symbol: "USDC" }), tok())).toBe("spam");
    expect(computeReviewTier(NEEDS_REVIEW_REASON, tok({ symbol: "weth" }), tok())).toBe("spam");
  });

  it("does NOT flag the real (cgId-bearing) major token", () => {
    expect(computeReviewTier(NEEDS_REVIEW_REASON, tok({ symbol: "USDC", coingeckoCoinId: "usd-coin" }), tok())).toBe("review");
  });

  it("does NOT flag a generic ticker collision (SPCX / AI / ROBO)", () => {
    for (const symbol of ["SPCX", "AI", "ROBO", "PAW"]) {
      expect(computeReviewTier(NEEDS_REVIEW_REASON, tok({ symbol }), tok())).toBe("review");
    }
  });

  it("defaults a genuine-but-uncertain pair to review", () => {
    expect(computeReviewTier(NEEDS_REVIEW_REASON, tok({ symbol: "AAA" }), tok({ symbol: "BBB" }))).toBe("review");
  });
});

describe("runVerdictForPair persists reviewTier", () => {
  it("sets a tier on a NeedsReview pair and clears it on a verified pair", async () => {
    // Two no-cgId tokens → no identity → NeedsReview → tier "review" (default).
    const a0 = await seedToken({ symbol: "AAA" });
    const a1 = await seedToken({ symbol: "BBB" });
    const nr = await seedPair(a0.id, a1.id);
    const out = await runVerdictForPair(nr.id);
    expect(out.result?.verdict).toBe(TokenPairStatus.NeedsReview);
    expect((await testPrisma.pair.findUnique({ where: { id: nr.id } }))?.reviewTier).toBe("review");

    // Clean cgId pair → AutoVerified → tier null.
    const b0 = await seedToken({ coingeckoCoinId: "weth" });
    const b1 = await seedToken({ coingeckoCoinId: "usd-coin", decimals: 6 });
    const av = await seedPair(b0.id, b1.id);
    await runVerdictForPair(av.id);
    const avRow = await testPrisma.pair.findUnique({ where: { id: av.id } });
    expect(avRow?.status).toBe(TokenPairStatus.AutoVerified);
    expect(avRow?.reviewTier).toBeNull();
  });
});
