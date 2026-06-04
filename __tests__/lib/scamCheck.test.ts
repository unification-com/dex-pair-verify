// Unit tests for the pure parts of the GoPlus scam check (A.7).

import { describe, expect, it } from "vitest";

import { evaluateScamSignals, goplusChainId } from "../../lib/scamCheck";

describe("goplusChainId", () => {
  it("maps supported chains to GoPlus numeric ids", () => {
    expect(goplusChainId("eth")).toBe("1");
    expect(goplusChainId("bsc")).toBe("56");
    expect(goplusChainId("polygon_pos")).toBe("137");
    expect(goplusChainId("xdai")).toBe("100");
  });

  it("returns null for chains GoPlus doesn't index", () => {
    expect(goplusChainId("qom")).toBeNull();
    expect(goplusChainId("solana")).toBeNull();
  });
});

describe("evaluateScamSignals", () => {
  it("does not flag a clean token", () => {
    const r = evaluateScamSignals({ is_honeypot: "0", buy_tax: "0", sell_tax: "0" });
    expect(r.flagged).toBe(false);
    expect(r.reasons).toHaveLength(0);
  });

  it("flags a honeypot", () => {
    const r = evaluateScamSignals({ is_honeypot: "1" });
    expect(r.flagged).toBe(true);
    expect(r.reasons).toContain("honeypot");
  });

  it("flags the hard signals (cannot-sell / self-destruct)", () => {
    expect(evaluateScamSignals({ cannot_sell_all: "1" }).flagged).toBe(true);
    expect(evaluateScamSignals({ selfdestruct: "1" }).flagged).toBe(true);
  });

  it("does NOT flag the weak signals alone (hidden_owner / honeypot-linked creator)", () => {
    // These false-positive on legit established tokens (RSR, BAND, OCEAN…), so
    // they no longer flag on their own — only the hard signals above do.
    expect(evaluateScamSignals({ hidden_owner: "1" }).flagged).toBe(false);
    expect(evaluateScamSignals({ honeypot_with_same_creator: "1" }).flagged).toBe(false);
  });

  it("flags extreme buy/sell tax but not modest tax", () => {
    expect(evaluateScamSignals({ sell_tax: "0.5" }).flagged).toBe(true); // 50%
    expect(evaluateScamSignals({ buy_tax: "0.03" }).flagged).toBe(false); // 3%
  });

  it("does not flag mintable/pausable alone (legit tokens have them)", () => {
    expect(evaluateScamSignals({ is_mintable: "1", transfer_pausable: "1" }).flagged).toBe(false);
  });

  it("treats null / empty security data as unflagged", () => {
    expect(evaluateScamSignals(null).flagged).toBe(false);
    expect(evaluateScamSignals({}).flagged).toBe(false);
  });
});
