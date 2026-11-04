// Unit tests for the pure trading-organicity summary (B4).

import { describe, expect, it } from "vitest";

import { PoolTrades, summariseOrganicity } from "../../lib/organicity";

const pool = (over: Partial<PoolTrades> = {}): PoolTrades => ({ buys24h: 0, sells24h: 0, buyers24h: 0, sellers24h: 0, ...over });

describe("summariseOrganicity", () => {
  it("returns quiet with no label-able activity when there are no trades", () => {
    const s = summariseOrganicity([]);
    expect(s.trades).toBe(0);
    expect(s.tradersPerTrade).toBeNull();
    expect(s.label).toBe("quiet");
  });

  it("sums buys/sells/buyers/sellers across pools", () => {
    const s = summariseOrganicity([
      pool({ buys24h: 100, sells24h: 80, buyers24h: 40, sellers24h: 30 }),
      pool({ buys24h: 50, sells24h: 20, buyers24h: 20, sellers24h: 10 }),
    ]);
    expect(s.buys).toBe(150);
    expect(s.sells).toBe(100);
    expect(s.buyers).toBe(60);
    expect(s.sellers).toBe(40);
    expect(s.trades).toBe(250);
    expect(s.traders).toBe(100);
    expect(s.pools).toBe(2);
  });

  it("labels a near-1 traders/trade ratio organic", () => {
    // 200 trades by ~190 distinct wallets (well above the quiet floor).
    const s = summariseOrganicity([pool({ buys24h: 100, sells24h: 100, buyers24h: 96, sellers24h: 94 })]);
    expect(s.tradersPerTrade).toBeCloseTo(0.95, 2);
    expect(s.label).toBe("organic");
  });

  it("labels an active blue-chip ratio organic, not a red flag (calibration)", () => {
    // WETH-shaped: ~0.44 — repeat traders/arb bots, but legitimate.
    const s = summariseOrganicity([pool({ buys24h: 100000, sells24h: 82000, buyers24h: 45000, sellers24h: 35000 })]);
    expect(s.tradersPerTrade).toBeCloseTo(0.44, 2);
    expect(s.label).toBe("organic");
  });

  it("labels a moderate ratio mixed", () => {
    // 1000 trades, 250 traders → 0.25.
    const s = summariseOrganicity([pool({ buys24h: 600, sells24h: 400, buyers24h: 150, sellers24h: 100 })]);
    expect(s.tradersPerTrade).toBeCloseTo(0.25, 2);
    expect(s.label).toBe("mixed");
  });

  it("labels few wallets churning many trades wash-like", () => {
    // 1000 trades from ~30 wallets → ratio 0.03.
    const s = summariseOrganicity([pool({ buys24h: 600, sells24h: 400, buyers24h: 18, sellers24h: 12 })]);
    expect(s.tradersPerTrade).toBeCloseTo(0.03, 2);
    expect(s.label).toBe("wash-like");
  });

  it("labels sparse activity quiet regardless of ratio (sparse genuine token, not a flag)", () => {
    // 60 trades — below the 100-trade floor, so a low ratio here doesn't earn a
    // wash verdict; a genuinely quiet token reads "quiet", not suspicious.
    const churny = summariseOrganicity([pool({ buys24h: 40, sells24h: 20, buyers24h: 4, sellers24h: 2 })]);
    expect(churny.trades).toBe(60);
    expect(churny.label).toBe("quiet");
    // ...and the same holds even with a perfect ratio.
    const perfect = summariseOrganicity([pool({ buys24h: 30, sells24h: 30, buyers24h: 30, sellers24h: 30 })]);
    expect(perfect.label).toBe("quiet");
  });

  it("counts only pools that had activity in `pools`", () => {
    const s = summariseOrganicity([pool({ buys24h: 40, sells24h: 40, buyers24h: 30, sellers24h: 30 }), pool()]);
    expect(s.pools).toBe(1);
  });
});
