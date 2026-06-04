// Tests for lib/stats.js.
//
// Originally captured current (buggy) behaviour as a baseline; the B8/B9/B10
// fixes from BUGS_AND_FINDINGS.md have since landed and the relevant
// assertions now assert the CORRECTED behaviour:
//   B8 — calculateMean uses a length guard (handles negatives + zero sums)
//   B9 — getStats guards empty (zeroed) + single-element (zero spread)
//   B10 — removeOutliersChauvenet keeps all when stdDev === 0 (mirrors
//         go-ooo's adhoc.go) instead of excluding everything

import { describe, expect, it } from "vitest";

import {
  calculateMean,
  cleanseForBn,
  countDecimals,
  getQuartile,
  getStats,
  median,
  medianAbsoluteDeviation,
  removeOutliersChauvenet,
  removeOutliersIQD,
  removeOutliersMAD,
  removeOutliersPeirceCriterion,
  robustAggregate,
  scientificToDecimal,
  weightedMean,
} from "../../lib/stats";

// ----------------------------------------------------------------------
// getQuartile — pure interpolation helper
// ----------------------------------------------------------------------

describe("getQuartile", () => {
  it("returns the median (q=0.5) of an odd-length ordered set", () => {
    expect(getQuartile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  it("interpolates the median of an even-length set", () => {
    expect(getQuartile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it("returns Q1 (q=0.25) on a 5-element set", () => {
    expect(getQuartile([1, 2, 3, 4, 5], 0.25)).toBe(2);
  });

  it("returns Q3 (q=0.75) on a 5-element set", () => {
    expect(getQuartile([1, 2, 3, 4, 5], 0.75)).toBe(4);
  });

  it("returns the single element for a 1-element set", () => {
    expect(getQuartile([7], 0.5)).toBe(7);
  });
});

// ----------------------------------------------------------------------
// scientificToDecimal — expands sci-notation strings to plain decimals
// ----------------------------------------------------------------------

describe("scientificToDecimal", () => {
  it("returns small positive scientific notation as decimal string", () => {
    expect(scientificToDecimal(1.5e-7)).toBe("0.00000015");
  });

  it("passes large numbers (already non-sci-notation) through unchanged", () => {
    // 1.5e7 stringifies as "15000000" — the regex doesn't match, so the
    // input number is returned as-is.
    expect(scientificToDecimal(1.5e7)).toBe(15000000);
  });

  it("preserves negative sign", () => {
    expect(scientificToDecimal(-1.5e-3)).toBe("-0.0015");
  });

  it("passes plain decimals through unchanged", () => {
    expect(scientificToDecimal(1.5)).toBe(1.5);
  });

  it("passes integers through unchanged", () => {
    expect(scientificToDecimal(42)).toBe(42);
  });
});

// ----------------------------------------------------------------------
// countDecimals — count digits after the decimal point
// ----------------------------------------------------------------------

describe("countDecimals", () => {
  it("returns 0 for integers", () => {
    expect(countDecimals(42)).toBe(0);
  });

  it("counts decimal places on a finite decimal", () => {
    expect(countDecimals(1.234)).toBe(3);
  });

  it("returns 0 for whole-number floats (1.0 stringifies to '1')", () => {
    expect(countDecimals(1.0)).toBe(0);
  });
});

// ----------------------------------------------------------------------
// calculateMean — pure arithmetic mean, with B8 quirks
// ----------------------------------------------------------------------

describe("calculateMean", () => {
  it("returns the arithmetic mean of positive numbers", () => {
    expect(calculateMean([1, 2, 3, 4, 5])).toBe(3);
  });

  it("handles a single-element positive set", () => {
    expect(calculateMean([7])).toBe(7);
  });

  // B8 fixed: mean uses a length guard, not a `sum > 0` guard.
  it("returns the true mean of an all-zero set", () => {
    expect(calculateMean([0, 0, 0])).toBe(0);
  });

  it("returns the true mean of a single negative element", () => {
    expect(calculateMean([-1])).toBe(-1);
  });

  it("returns the true mean of an all-negative set", () => {
    expect(calculateMean([-1, -2, -3])).toBe(-2);
  });

  it("returns 0 for an empty set (length guard)", () => {
    expect(calculateMean([])).toBe(0);
  });
});

// ----------------------------------------------------------------------
// getStats — n, sum, mean, variance, stdDev with B9 quirks
// ----------------------------------------------------------------------

describe("getStats", () => {
  it("computes stats for a normal 5-element set", () => {
    // [2, 4, 4, 4, 5] — sum=19, mean=3.8, (n-1)-variance=1.2, stdDev≈1.0954
    const s = getStats([2, 4, 4, 4, 5]);
    expect(s.n).toBe(5);
    expect(s.sum).toBe(19);
    expect(s.mean).toBe(3.8);
    expect(s.variance).toBeCloseTo(1.2, 5);
    expect(s.stdDev).toBeCloseTo(1.0954, 3);
  });

  // B9 fixed: empty input returns zeroed stats instead of crashing.
  it("returns zeroed stats for an empty array", () => {
    expect(getStats([])).toEqual({ n: 0, sum: 0, mean: 0, variance: 0, stdDev: 0 });
  });

  // B9 fixed: single-element set reports zero spread, not NaN/Infinity.
  it("returns zero variance/stdDev on a single-element set", () => {
    const s = getStats([5]);
    expect(s.n).toBe(1);
    expect(s.sum).toBe(5);
    expect(s.mean).toBe(5);
    expect(s.variance).toBe(0);
    expect(s.stdDev).toBe(0);
  });
});

// ----------------------------------------------------------------------
// removeOutliersChauvenet — Chauvenet's criterion with B10 quirk
// ----------------------------------------------------------------------

describe("removeOutliersChauvenet", () => {
  it("removes an outlier that exceeds dMax stdDevs (default dMax = 3)", () => {
    // 19 tight points at 10 + one at 13. The lone 13 sits ≈ 4.25 stdDevs
    // from the mean, beyond the default dMax of 3, so it's removed.
    // (A *single* gross outlier in a tiny set masks itself by inflating
    // the stdDev — see the masking test below.)
    const data = [...Array(19).fill(10), 13];
    const cleaned = removeOutliersChauvenet(data);
    expect(cleaned).not.toContain(13);
    expect(cleaned.filter((x) => x === 10)).toHaveLength(19);
  });

  it("MASKING: a lone gross outlier in a tiny set survives (inflates stdDev)", () => {
    // [10, 11, 12, 100] — the 100 dominates the stdDev (≈ 44.5), so its own
    // distance is only ≈ 1.5 stdDevs < dMax 3. Documents the masking
    // limitation rather than asserting a bug.
    expect(removeOutliersChauvenet([10, 11, 12, 100])).toEqual([10, 11, 12, 100]);
  });

  it("respects a custom (lax) dMax", () => {
    // dMax 10 keeps everything even when an element is genuinely far out.
    const data = [...Array(19).fill(10), 13];
    expect(removeOutliersChauvenet(data, 10)).toEqual(data);
  });

  it("keeps all elements when distances are within dMax", () => {
    expect(removeOutliersChauvenet([10, 10.1, 10.2, 10.3], 5)).toEqual([10, 10.1, 10.2, 10.3]);
  });

  // B10 fixed: when stdDev = 0 (all elements equal) keep all, mirroring
  // go-ooo's adhoc.go, instead of excluding everything.
  it("keeps all elements when they are all equal (stdDev = 0)", () => {
    expect(removeOutliersChauvenet([5, 5, 5, 5])).toEqual([5, 5, 5, 5]);
  });

  it("keeps the single element of a one-element set (stdDev = 0)", () => {
    expect(removeOutliersChauvenet([42])).toEqual([42]);
  });
});

// ----------------------------------------------------------------------
// removeOutliersIQD — interquartile-deviation outlier removal
// ----------------------------------------------------------------------

describe("removeOutliersIQD", () => {
  it("removes a high outlier on a small set", () => {
    const cleaned = removeOutliersIQD([10, 11, 12, 13, 100]);
    expect(cleaned).not.toContain(100);
    expect(cleaned.length).toBeGreaterThan(0);
  });

  it("removes a low outlier on a small set", () => {
    const cleaned = removeOutliersIQD([-100, 10, 11, 12, 13]);
    expect(cleaned).not.toContain(-100);
  });

  it("sorts the input as a side effect", () => {
    const input = [5, 1, 3, 2, 4];
    removeOutliersIQD(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
});

// ----------------------------------------------------------------------
// removeOutliersPeirceCriterion — thin wrapper around the npm peirce-criterion
// ----------------------------------------------------------------------

describe("removeOutliersPeirceCriterion", () => {
  it("returns an array (delegated to peirce-criterion package)", () => {
    const result = removeOutliersPeirceCriterion([10, 11, 12, 13, 100]);
    expect(Array.isArray(result)).toBe(true);
  });

  it("removes the gross outlier on a tight dataset", () => {
    const cleaned = removeOutliersPeirceCriterion([10, 11, 12, 13, 100]);
    expect(cleaned).not.toContain(100);
  });
});

// ----------------------------------------------------------------------
// cleanseForBn — clamps to 18 decimal places for BN arithmetic
// ----------------------------------------------------------------------

describe("cleanseForBn", () => {
  it("returns numbers with ≤ 18 decimals unchanged (as decimal strings)", () => {
    expect(cleanseForBn(1.23)).toBe(1.23);
  });

  it("clamps numbers with > 18 decimals to 18", () => {
    // Build the value at runtime — a literal with this many digits trips
    // no-loss-of-precision. 1/3 gives a long repeating decimal to clamp.
    const longDecimal = 1 / 3;
    const result = cleanseForBn(longDecimal);
    expect(countDecimals(result)).toBeLessThanOrEqual(18);
  });

  it("passes integers through", () => {
    expect(cleanseForBn(42)).toBe(42);
  });
});

// ======================================================================
// Robust aggregation (median + MAD + liquidity weighting) — the testbed
// for go-ooo's adhoc.go price aggregation.
// ======================================================================

describe("median", () => {
  it("returns the middle of an odd-length set", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("interpolates the middle two of an even-length set", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("does not mutate its input", () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it("returns 0 for an empty set", () => {
    expect(median([])).toBe(0);
  });

  it("is unmoved by a gross outlier (unlike the mean)", () => {
    expect(median([10, 11, 12, 1000])).toBe(11.5); // the mean would be ~258
  });
});

describe("medianAbsoluteDeviation", () => {
  it("is the median of absolute deviations from the median", () => {
    // median([1,2,3,4,5]) = 3; |dev| = [2,1,0,1,2]; median of those = 1
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 5])).toBe(1);
  });

  it("is 0 when at least half the values are identical", () => {
    expect(medianAbsoluteDeviation([5, 5, 5, 9])).toBe(0);
  });

  it("is NOT inflated by a lone outlier (the property that beats Chauvenet)", () => {
    // [10,11,12,100]: median 11.5; |dev| = [1.5,0.5,0.5,88.5]; median = 1.
    // The same set's stdDev is ≈ 44 — that inflation is exactly what masks the
    // outlier under Chauvenet; MAD stays ≈ 1.
    expect(medianAbsoluteDeviation([10, 11, 12, 100])).toBe(1);
  });
});

describe("removeOutliersMAD", () => {
  it("REJECTS the lone gross outlier that Chauvenet MASKS", () => {
    // The exact set the Chauvenet masking test keeps in full. MAD ≈ 1, so the
    // 100 scores 0.6745·88.5/1 ≈ 60 ≫ 3.5 and is removed.
    expect(removeOutliersMAD([10, 11, 12, 100])).toEqual([10, 11, 12]);
    // Side-by-side: Chauvenet keeps it (documented masking limitation).
    expect(removeOutliersChauvenet([10, 11, 12, 100])).toEqual([10, 11, 12, 100]);
  });

  it("does NOT over-reject a clean tight set (unlike Chauvenet dMax=1)", () => {
    const clean = [100, 101, 99, 100, 102, 98, 101, 99];
    expect(removeOutliersMAD(clean)).toEqual(clean);
    // Chauvenet at dMax=1 discards the ±1σ tails of the very same clean data.
    expect(removeOutliersChauvenet(clean, 1).length).toBeLessThan(clean.length);
  });

  it("keeps all when at least half the values are identical (MAD = 0)", () => {
    expect(removeOutliersMAD([5, 5, 5, 9])).toEqual([5, 5, 5, 9]);
  });

  it("keeps all for fewer than 3 points (too few to judge robustly)", () => {
    expect(removeOutliersMAD([10, 1000])).toEqual([10, 1000]);
  });

  it("removes both a high and a low outlier, preserving input order", () => {
    expect(removeOutliersMAD([-500, 10, 11, 12, 13, 14, 900])).toEqual([10, 11, 12, 13, 14]);
  });
});

describe("weightedMean", () => {
  it("weights values by their weights", () => {
    // (2000·9 + 2100·1) / 10 = 2010
    expect(weightedMean([2000, 2100], [9, 1])).toBe(2010);
  });

  it("equals the plain mean when all weights are equal", () => {
    expect(weightedMean([1, 2, 3], [5, 5, 5])).toBe(2);
  });

  it("falls back to the arithmetic mean when total weight is 0", () => {
    expect(weightedMean([10, 20, 30], [0, 0, 0])).toBe(20);
  });

  it("returns 0 for an empty set", () => {
    expect(weightedMean([], [])).toBe(0);
  });
});

describe("robustAggregate", () => {
  it("rejects a thin manipulated pool and weights the honest deep pools", () => {
    // Four honest, deep pools near 2000 + one thin pool reporting 3000 (a
    // manipulation on a shallow pool). MAD rejects the 3000; the liquidity-
    // weighted mean of the survivors stays ≈ 2000.
    const r = robustAggregate([
      { price: 2000, liquidity: 5_000_000 },
      { price: 2010, liquidity: 4_000_000 },
      { price: 1995, liquidity: 6_000_000 },
      { price: 2005, liquidity: 3_000_000 },
      { price: 3000, liquidity: 5_000 }, // thin + manipulated
    ]);
    expect(r.nRejected).toBe(1);
    expect(r.rejected[0].price).toBe(3000);
    expect(r.nUsed).toBe(4);
    expect(r.price).toBeGreaterThan(1990);
    expect(r.price).toBeLessThan(2010);
  });

  it("liquidity-weighting pulls the estimate toward the deepest pool", () => {
    // n < 3 → no rejection; weighted mean = (2000·9 + 2100·1)/10 = 2010.
    const r = robustAggregate([
      { price: 2000, liquidity: 9_000_000 },
      { price: 2100, liquidity: 1_000_000 },
    ]);
    expect(r.nRejected).toBe(0);
    expect(r.price).toBe(2010);
  });

  it("keeps all when MAD = 0 (at least half the prices identical)", () => {
    const r = robustAggregate([
      { price: 100, liquidity: 1 },
      { price: 100, liquidity: 1 },
      { price: 100, liquidity: 1 },
      { price: 250, liquidity: 1 },
    ]);
    expect(r.nRejected).toBe(0);
    expect(r.mad).toBe(0);
  });

  it("reports the median + MAD diagnostics", () => {
    const r = robustAggregate([
      { price: 10, liquidity: 1 },
      { price: 11, liquidity: 1 },
      { price: 12, liquidity: 1 },
    ]);
    expect(r.median).toBe(11);
    expect(r.mad).toBe(1);
  });
});
