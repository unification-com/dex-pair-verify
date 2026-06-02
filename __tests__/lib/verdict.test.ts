// Tests for lib/verdict.ts fence functions (A.2). Each fence is pure, so these
// are plain unit tests covering pass / fail / skip (unknown-input) paths.

import { describe, expect, it } from "vitest";

import {
  bothTokensHaveCgId,
  cgPriceWithinTolerance,
  decimalsLookSane,
  dexFactoryMatchesCanonical,
  meetsAge,
  meetsLiquidity,
  meetsTxCount,
  tokenAddressesMatchCanonical,
} from "../../lib/verdict";

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
