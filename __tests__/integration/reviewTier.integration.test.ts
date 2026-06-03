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
  it("flags an impostor reason as spam", async () => {
    const t0 = await seedToken();
    const t1 = await seedToken();
    const tier = await computeReviewTier("a token address does not match the canonical contract (possible impostor)", t0, t1);
    expect(tier).toBe("spam");
  });

  it("flags a scam-flagged token as spam", async () => {
    const t0 = await seedToken({ isScamFlagged: true });
    const t1 = await seedToken();
    expect(await computeReviewTier(NEEDS_REVIEW_REASON, t0, t1)).toBe("spam");
  });

  it("flags an exact-symbol spoof of a known cgId token as spam", async () => {
    await seedToken({ symbol: "USDC", coingeckoCoinId: "usd-coin" }); // the real one (has cgId)
    const fake = await seedToken({ symbol: "USDC", coingeckoCoinId: "" }); // no-cgId impostor
    const other = await seedToken({ coingeckoCoinId: "weth" });
    expect(await computeReviewTier(NEEDS_REVIEW_REASON, fake, other)).toBe("spam");
  });

  it("does not treat a cgId token as a spoof of itself", async () => {
    const real = await seedToken({ symbol: "USDC", coingeckoCoinId: "usd-coin" });
    const other = await seedToken({ coingeckoCoinId: "weth" });
    expect(await computeReviewTier(NEEDS_REVIEW_REASON, real, other)).toBe("review");
  });

  it("defaults a genuine-but-uncertain pair to review", async () => {
    const t0 = await seedToken({ symbol: "AAA" });
    const t1 = await seedToken({ symbol: "BBB" });
    expect(await computeReviewTier(NEEDS_REVIEW_REASON, t0, t1)).toBe("review");
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
