// Tests for lib/identity/aggregate.ts — the pure identity-signal aggregator (T1).

import { describe, expect, it } from "vitest";

import { aggregateIdentity, MIN_INDEPENDENT_CATEGORIES } from "../../lib/identity/aggregate";
import { IdentitySignal } from "../../lib/identity/types";

const NOW = 1_700_000_000;

const sig = (source: string, category: IdentitySignal["category"], confirmed: boolean): IdentitySignal => ({
  source,
  category,
  confirmed,
});

describe("aggregateIdentity", () => {
  it("confirms on a curated token-list match ALONE (self-sufficient, vetted)", () => {
    const r = aggregateIdentity([sig("tokenlist:uniswap", "tokenlist", true)], NOW);
    expect(r.confirmed).toBe(true);
    expect(r.confirmedCategoryCount).toBe(1);
    expect(r.checkedAt).toBe(NOW);
  });

  it("does NOT confirm on GoPlus alone (needs corroboration — a spoof can be open-source)", () => {
    const r = aggregateIdentity([sig("goplus", "security-api", true)], NOW);
    expect(r.confirmed).toBe(false);
    expect(r.confirmedCategoryCount).toBe(1);
  });

  it("confirms when two non-self-sufficient categories agree", () => {
    const r = aggregateIdentity(
      [sig("goplus", "security-api", true), sig("onchain:erc20", "onchain", true)],
      NOW,
    );
    expect(r.confirmed).toBe(true);
    expect(r.confirmedCategoryCount).toBe(2);
  });

  it("does NOT count a token list toward self-sufficiency unless it actually confirms", () => {
    const r = aggregateIdentity(
      [sig("tokenlist:uniswap", "tokenlist", false), sig("goplus", "security-api", true)],
      NOW,
    );
    expect(r.confirmed).toBe(false); // tokenlist didn't confirm; GoPlus alone insufficient
    expect(r.confirmedCategoryCount).toBe(1);
  });

  it("returns not-confirmed for an empty signal set", () => {
    const r = aggregateIdentity([], NOW);
    expect(r.confirmed).toBe(false);
    expect(r.confirmedCategoryCount).toBe(0);
    expect(r.signals).toEqual([]);
  });

  it("keeps the raw signals for audit", () => {
    const signals = [sig("onchain:erc20-shape", "onchain", true), sig("goplus", "security-api", true)];
    const r = aggregateIdentity(signals, NOW);
    expect(r.signals).toEqual(signals);
    expect(r.confirmedCategoryCount).toBeGreaterThanOrEqual(MIN_INDEPENDENT_CATEGORIES);
  });
});
