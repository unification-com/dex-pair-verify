// Tests for lib/astroportAdapter.ts — the Astroport (Neutron) ingest adapter: discovery of clean
// 2-asset, chain-registry-identified pools from a stubbed Astroport pool set, normalised via the
// shared Cosmos curation. The chain-registry is stubbed via the memoised cache; the Astroport pools
// transport is injected through the request.

import { afterEach, describe, expect, it } from "vitest";

import { AstroportPool, AstroportPoolsFetcher } from "../../lib/astroport";
import { astroportAdapter } from "../../lib/astroportAdapter";
import { cosmosAssetMap, _clearCosmosRegistryCache } from "../../lib/cosmosRegistry";
import { PoolPageRequest } from "../../lib/ingestAdapter";

const NTRN = "untrn";
const USDC = "ibc/B559A80D62249C8AA07A380E2A2BEA6E5CA9A6F079C912C3A9E9B494105E4F81";
const ATOM = "ibc/C4CFF46FD6DE35CA4CF4CE031E643C8FDC9BA3DB97C638100D72C7F006DCA60";
const JUNK = "factory/neutron1junk/unlisted";

const REGISTRY = {
  assets: [
    { base: NTRN, symbol: "NTRN", name: "Neutron", display: "ntrn", coingecko_id: "neutron-3", denom_units: [{ denom: NTRN, exponent: 0 }, { denom: "ntrn", exponent: 6 }] },
    { base: USDC, symbol: "USDC", name: "USDC", display: "usdc", coingecko_id: "usd-coin", denom_units: [{ denom: USDC, exponent: 0 }, { denom: "usdc", exponent: 6 }] },
    { base: ATOM, symbol: "ATOM", name: "Cosmos Hub Atom", display: "atom", coingecko_id: "cosmos", denom_units: [{ denom: ATOM, exponent: 0 }, { denom: "atom", exponent: 6 }] },
  ],
};

const asset = (denom: string, symbol: string, priceUSD: number) => ({ denom, symbol, decimals: 6, priceUSD });
const POOLS: AstroportPool[] = [
  { poolAddress: "neutron1pool1", poolType: "concentrated", isDeregistered: false, totalLiquidityUSD: 80000, dayVolumeUSD: 2216, assets: [asset(USDC, "USDC", 1), asset(NTRN, "NTRN", 0.4)] },
  { poolAddress: "neutron1pool1b", poolType: "concentrated", isDeregistered: false, totalLiquidityUSD: 30000, dayVolumeUSD: 5, assets: [asset(NTRN, "NTRN", 0.4), asset(USDC, "USDC", 1)] }, // shallower NTRN/USDC → deduped out
  { poolAddress: "neutron1pool2", poolType: "xyk", isDeregistered: false, totalLiquidityUSD: 50000, dayVolumeUSD: 1000, assets: [asset(ATOM, "ATOM", 2.88), asset(USDC, "USDC", 1)] },
  { poolAddress: "neutron1pool3", poolType: "transmuter", isDeregistered: false, totalLiquidityUSD: 99999, dayVolumeUSD: 1, assets: [asset(USDC, "USDC", 1), asset(ATOM, "ATOM", 2.88)] }, // non-AMM type → skipped
  { poolAddress: "neutron1pool4", poolType: "xyk", isDeregistered: false, totalLiquidityUSD: 70000, dayVolumeUSD: 1, assets: [asset(JUNK, "JUNK", 1), asset(NTRN, "NTRN", 0.4)] }, // unlisted denom → not identified
  { poolAddress: "neutron1pool5", poolType: "concentrated", isDeregistered: true, totalLiquidityUSD: 100000, dayVolumeUSD: 1, assets: [asset(ATOM, "ATOM", 2.88), asset(NTRN, "NTRN", 0.4)] }, // deregistered → skipped
  { poolAddress: "", poolType: "xyk", isDeregistered: false, totalLiquidityUSD: 60000, dayVolumeUSD: 1, assets: [asset(NTRN, "NTRN", 0.4), asset(USDC, "USDC", 1)] }, // no pool address → skipped
  { poolAddress: "neutron1multi", poolType: "stable", isDeregistered: false, totalLiquidityUSD: 90000, dayVolumeUSD: 1, assets: [asset(USDC, "USDC", 1), asset(ATOM, "ATOM", 2.88), asset(NTRN, "NTRN", 0.4)] }, // 3-asset → skipped
];

const poolsFetcher: AstroportPoolsFetcher = async () => POOLS;
const req = (over: Partial<PoolPageRequest> = {}): PoolPageRequest => ({ now: 1, poolsFetcher, ...over });

afterEach(() => {
  _clearCosmosRegistryCache();
});

const seedRegistry = () => cosmosAssetMap("neutron", { force: true, fetcher: async () => REGISTRY });

describe("astroportAdapter.poolPage", () => {
  it("discovers clean 2-asset registry-identified pools, deduped to the deepest per pair", async () => {
    await seedRegistry();
    const page = await astroportAdapter.poolPage("neutron", "astroport_neutron", 1, req());
    // Registry-identified candidates = pool1, pool1b, pool2 (transmuter, unlisted-denom, deregistered,
    // no-address and 3-asset pools are all excluded). Deduped → NTRN/USDC (pool1) + ATOM/USDC (pool2).
    expect(page.poolCount).toBe(3);
    expect(page.pools.map((p) => p.poolId).sort()).toEqual(["neutron1pool1", "neutron1pool2"]);
  });

  it("orients the stablecoin to the quote and reads liquidity/volume/price inline", async () => {
    await seedRegistry();
    const page = await astroportAdapter.poolPage("neutron", "astroport_neutron", 1, req());
    const ntrnUsdc = page.pools.find((p) => p.poolId === "neutron1pool1");
    expect(ntrnUsdc?.baseAddress).toBe(NTRN); // USDC was listed first but is flipped to the quote
    expect(ntrnUsdc?.quoteAddress).toBe(USDC);
    expect(ntrnUsdc?.reserveUsd).toBe(80000);
    expect(ntrnUsdc?.volume24hUsd).toBe(2216);
    expect(ntrnUsdc?.baseTokenPriceUsd).toBe(0.4);
    expect(ntrnUsdc?.quoteTokenPriceUsd).toBe(1);
    expect(page.tokens.get(NTRN)).toMatchObject({ symbol: "NTRN", decimals: 6, coingeckoCoinId: "neutron-3", priceUsd: 0.4 });
  });

  it("returns an empty page beyond page 1 and for an unmapped chain", async () => {
    await seedRegistry();
    expect((await astroportAdapter.poolPage("neutron", "astroport_neutron", 2, req())).poolCount).toBe(0);
    expect((await astroportAdapter.poolPage("cosmoshub", "x", 1, req())).poolCount).toBe(0);
  });
});
