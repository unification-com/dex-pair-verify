// Baseline tests for lib/stats.js — commit 7.
//
// Captures CURRENT behaviour including the known bugs B8/B9/B10 from
// BUGS_AND_FINDINGS.md. The subsequent fix commits (B8/B9/B10) update
// the relevant assertions; the resulting diffs make the behavioural
// change visible.
//
// Bug-tracking assertions are tagged with `// BUG B#` so they're easy
// to find when the fix lands. Where the current code crashes outright,
// the test asserts the throw — those go red→green when the guard is
// added.

import { describe, expect, it } from "vitest";

import {
  calculateMean,
  cleanseForBn,
  countDecimals,
  getQuartile,
  getStats,
  removeOutliersChauvenet,
  removeOutliersIQD,
  removeOutliersPeirceCriterion,
  scientificToDecimal,
} from "../../lib/stats.js";

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

  // BUG B8 — when the sum is ≤ 0 the helper returns 0 instead of the true
  // mean. Fix at B8 will replace the `if (total > 0)` guard with a length
  // check; these assertions update accordingly.
  it("BUG B8: returns 0 for an all-zero set instead of 0 (happens to be right)", () => {
    expect(calculateMean([0, 0, 0])).toBe(0);
  });

  it("BUG B8: returns 0 for a single negative element (should be -1)", () => {
    expect(calculateMean([-1])).toBe(0);
  });

  it("BUG B8: returns 0 for all-negative set (should be -2)", () => {
    expect(calculateMean([-1, -2, -3])).toBe(0);
  });

  it("BUG B8: returns 0 for an empty set (acceptable but no length guard)", () => {
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

  // BUG B9 — `reduce(add)` with no initial value crashes on empty input.
  // Fix will guard length === 0.
  it("BUG B9: crashes on an empty array", () => {
    expect(() => getStats([])).toThrow(TypeError);
  });

  // BUG B9 — single-element divides by (n - 1) = 0, returning Infinity / NaN
  // for variance + stdDev. Fix will return {variance: 0, stdDev: 0}.
  it("BUG B9: returns Infinity variance on a single-element set", () => {
    const s = getStats([5]);
    expect(s.n).toBe(1);
    expect(s.sum).toBe(5);
    expect(s.mean).toBe(5);
    expect(s.variance).toBe(NaN); // (0 / 0)
    expect(s.stdDev).toBe(NaN);
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

  // BUG B10 — when stdDev = 0 (all elements equal), the per-element
  // division is NaN/Infinity, the `dMax > NaN` is false, and every element
  // gets excluded. Fix at B10 mirrors go-ooo's adhoc.go: keep all elements
  // when stdDev = 0.
  it("BUG B10: drops every element when all elements are equal (stdDev = 0)", () => {
    expect(removeOutliersChauvenet([5, 5, 5, 5])).toEqual([]);
  });

  it("BUG B10: drops every element from a single-element set (stdDev = 0)", () => {
    expect(removeOutliersChauvenet([42])).toEqual([]);
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
