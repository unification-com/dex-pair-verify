// Tests for the review-queue triage (T9) — computeReviewTier (pure) + the
// runVerdictForPair persistence (DB-backed, hence integration).

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, seedPair, seedToken, testPrisma } from "./helpers";
import { computeReviewTier } from "../../lib/reviewTier";
import { VERDICT_REASON } from "../../lib/verdict";
import { runVerdictForPair } from "../../lib/verdictRunner";
import { TokenPairStatus } from "../../types/types";

// A representative non-impostor NeedsReview outcome — the triage should default
// these to "review" unless a token trips the scam / fake-major-token checks.
const NON_IMPOSTOR = VERDICT_REASON.belowAutoVerifyBar;

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

  it("flags the canonical-impostor code as spam", () => {
    expect(computeReviewTier(VERDICT_REASON.canonicalImpostor, tok(), tok())).toBe("spam");
  });

  it("flags a scam-flagged token as spam", () => {
    expect(computeReviewTier(NON_IMPOSTOR, tok({ isScamFlagged: true }), tok())).toBe("spam");
  });

  it("flags a no-cgId token faking a MAJOR token (USDC/WETH) as spam, case-insensitively", () => {
    expect(computeReviewTier(NON_IMPOSTOR, tok({ symbol: "USDC" }), tok())).toBe("spam");
    expect(computeReviewTier(NON_IMPOSTOR, tok({ symbol: "weth" }), tok())).toBe("spam");
  });

  it("does NOT flag the real (cgId-bearing) major token", () => {
    expect(computeReviewTier(NON_IMPOSTOR, tok({ symbol: "USDC", coingeckoCoinId: "usd-coin" }), tok())).toBe("review");
  });

  it("does NOT flag a generic ticker collision (SPCX / AI / ROBO)", () => {
    for (const symbol of ["SPCX", "AI", "ROBO", "PAW"]) {
      expect(computeReviewTier(NON_IMPOSTOR, tok({ symbol }), tok())).toBe("review");
    }
  });

  it("defaults a genuine-but-uncertain pair to review", () => {
    expect(computeReviewTier(NON_IMPOSTOR, tok({ symbol: "AAA" }), tok({ symbol: "BBB" }))).toBe("review");
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
