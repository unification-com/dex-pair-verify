// Tests for the phantom-liquidity guard (a deep-looking pool with near-zero
// turnover reports a reserveUsd that isn't real, usable liquidity).

import { describe, expect, it } from "vitest";

import { isPhantomLiquidity, PHANTOM_TURNOVER_FLOOR } from "../../lib/phantomLiquidity";

describe("isPhantomLiquidity", () => {
  it("flags a deep pool with near-zero turnover (the BGPT case)", () => {
    // $92M reserve, $7 volume ⇒ turnover ~8e-8 ≪ 1e-4.
    expect(isPhantomLiquidity(92_000_000, 7, 25000)).toBe(true);
  });

  it("flags a deep pool with literally zero 24h volume", () => {
    expect(isPhantomLiquidity(1_000_000, 0, 25000)).toBe(true);
  });

  it("does NOT flag a quiet-but-active pool above the turnover floor", () => {
    // turnover = 200 / 1e6 = 2e-4 > 1e-4.
    expect(isPhantomLiquidity(1_000_000, 200, 25000)).toBe(false);
  });

  it("does NOT flag a healthy pool", () => {
    expect(isPhantomLiquidity(1_000_000, 500_000, 25000)).toBe(false);
  });

  it("does NOT apply below the liquidity floor (handled by the normal gate)", () => {
    // reserve under the floor isn't 'deep-looking', so it's not a phantom — the
    // ordinary liquidity fence deals with it.
    expect(isPhantomLiquidity(10_000, 0, 25000)).toBe(false);
  });

  it("ignores a zero/negative reserve", () => {
    expect(isPhantomLiquidity(0, 0, 0)).toBe(false);
  });

  it("exposes a floor far below any active pool's turnover", () => {
    expect(PHANTOM_TURNOVER_FLOOR).toBeLessThan(0.001);
  });
});
