// Integration tests for lib/thresholds.ts buildThresholdMap — the B7 N+1 fix
// that loads thresholds for a pair set in one query.

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, testPrisma } from "./helpers";
import { buildThresholdMap } from "../../lib/thresholds";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("buildThresholdMap", () => {
  it("returns an empty map for no pairs", async () => {
    expect(await buildThresholdMap([])).toEqual({});
  });

  it("maps thresholds by chain then dex over the distinct (chain,dex) tuples", async () => {
    await testPrisma.threshold.create({ data: { chain: "eth", dex: "uniswap_v3", minLiquidityUsd: 1000, minTxCount: 50 } });
    await testPrisma.threshold.create({ data: { chain: "eth", dex: "sushiswap", minLiquidityUsd: 2000, minTxCount: 10 } });

    const map = await buildThresholdMap([
      { chain: "eth", dex: "uniswap_v3" },
      { chain: "eth", dex: "uniswap_v3" }, // duplicate (chain,dex) — deduped
      { chain: "eth", dex: "sushiswap" },
    ]);

    expect(map.eth.uniswap_v3.minReserveUsd).toBe(1000);
    expect(map.eth.uniswap_v3.minTxCount).toBe(50);
    expect(map.eth.sushiswap.minReserveUsd).toBe(2000);
  });

  it("omits a (chain,dex) that has no threshold row", async () => {
    const map = await buildThresholdMap([{ chain: "eth", dex: "uniswap_v3" }]);
    expect(map.eth?.uniswap_v3).toBeUndefined();
  });
});
