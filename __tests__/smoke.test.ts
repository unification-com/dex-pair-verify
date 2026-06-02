// Vitest smoke test (commit 6 — scaffold).
//
// Verifies the framework runs end-to-end: explicit imports from vitest,
// resolves a project module, exercises a pure function. Real coverage of
// `lib/stats.js` (B8/B9/B10 fixes) lands in the next test commit.

import { describe, expect, it } from "vitest";

import { getQuartile } from "../lib/stats";

describe("smoke", () => {
  it("trivial assertion passes", () => {
    expect(1 + 1).toBe(2);
  });

  it("can import + call a function from lib/stats.js", () => {
    // Median of an ordered list of 5 elements is the middle one.
    expect(getQuartile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });
});
