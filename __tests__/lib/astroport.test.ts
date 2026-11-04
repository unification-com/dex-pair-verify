// Tests for lib/astroport.ts astroportUsdPrices: a denom's USD price comes from the deepest active pool
// holding it, as go-ooo's Astroport client prices it.
import { describe, expect, it } from "vitest";

import { AstroportPool, astroportUsdPrices } from "../../lib/astroport";

const asset = (denom: string, priceUSD: number) => ({ denom, symbol: denom.toUpperCase(), decimals: 6, priceUSD });
const pool = (liquidity: number, assets: ReturnType<typeof asset>[], isDeregistered = false): AstroportPool => ({
  poolAddress: `neutron1pool${liquidity}`,
  poolType: "xyk",
  isDeregistered,
  assets,
  totalLiquidityUSD: liquidity,
  dayVolumeUSD: 0,
});

const POOLS: AstroportPool[] = [
  pool(1_000, [asset("untrn", 0.11), asset("uusdc", 1.02)]),
  pool(500_000, [asset("untrn", 0.1), asset("uusdc", 1)]), // the deepest pool for both
  pool(9_000_000, [asset("untrn", 5), asset("uusdc", 1)], true), // deregistered: ignored
  pool(2_000_000, [asset("datom", 0), asset("uusdc", 1)]), // unpriced asset: ignored
];

describe("astroportUsdPrices", () => {
  it("prices each denom from its deepest active pool", async () => {
    let asked = "";
    const prices = await astroportUsdPrices("https://api.test", "neutron", ["untrn", "uusdc", "datom"], async (_url, chainId) => {
      asked = chainId;
      return POOLS;
    });
    expect(asked).toBe("neutron-1");
    expect(Object.fromEntries(prices)).toEqual({ untrn: 0.1, uusdc: 1 });
  });

  it("returns nothing for a chain Astroport isn't queried on", async () => {
    expect((await astroportUsdPrices("https://api.test", "osmosis", ["untrn"], async () => POOLS)).size).toBe(0);
  });
});
