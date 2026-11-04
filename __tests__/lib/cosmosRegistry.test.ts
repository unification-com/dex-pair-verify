// Tests for lib/cosmosRegistry.ts — the Cosmos chain-registry asset-list resolver: denom → canonical
// {symbol, decimals, coingeckoCoinId}, keyed by the unique `base` denom (not the symbol), with the
// asset-list transport stubbed so no network call is made. The fixture mirrors the real Osmosis
// asset-list shape (verified live 2026-06-15): native + ibc + factory denoms, same-symbol variants,
// and an asset with no coingecko id.

import { afterEach, describe, expect, it } from "vitest";

import { AssetListFetcher, cosmosAssetMap, isCosmosRegistryChain, resolveCosmosAsset, _clearCosmosRegistryCache } from "../../lib/cosmosRegistry";

const OSMO = "uosmo";
const ATOM = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";
const USDC = "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4";
const AXLUSDC = "ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858";
const DYDX_ALLOYED = "factory/osmo1zem8r6dv6u38f6qpg546zy30946av8h5srgug0s4gcyy6cfecf3seac083/alloyed/allDYDX";

// A minimal asset-list in the chain-registry shape. AXLUSDC shares the symbol "USDC" with the native
// USDC but maps to a different coingecko id — proving keying must be by denom. DYDX_ALLOYED carries no
// coingecko_id. The last asset omits a matching display unit, exercising the decimals fallback.
const assetList = {
  assets: [
    { base: OSMO, symbol: "OSMO", name: "Osmosis", display: "osmo", coingecko_id: "osmosis", denom_units: [{ denom: "uosmo", exponent: 0 }, { denom: "osmo", exponent: 6 }] },
    { base: ATOM, symbol: "ATOM", name: "Cosmos Hub Atom", display: "atom", coingecko_id: "cosmos", denom_units: [{ denom: ATOM, exponent: 0 }, { denom: "atom", exponent: 6 }] },
    { base: USDC, symbol: "USDC", name: "USDC", display: "usdc", coingecko_id: "usd-coin", denom_units: [{ denom: USDC, exponent: 0 }, { denom: "usdc", exponent: 6 }] },
    { base: AXLUSDC, symbol: "USDC", name: "Axelar USDC", display: "usdc", coingecko_id: "axlusdc", denom_units: [{ denom: AXLUSDC, exponent: 0 }, { denom: "usdc", exponent: 6 }] },
    { base: DYDX_ALLOYED, symbol: "DYDX", name: "Alloyed DYDX", display: "allDYDX", denom_units: [{ denom: DYDX_ALLOYED, exponent: 0 }, { denom: "allDYDX", exponent: 18 }] },
    // Alloyed allBTC — the registry lists symbol/name but coingecko_id: null; the blue-chip overlay supplies "bitcoin".
    { base: "factory/osmo1.../alloyed/allBTC", symbol: "BTC", name: "Bitcoin", display: "allBTC", coingecko_id: null, denom_units: [{ denom: "factory/osmo1.../alloyed/allBTC", exponent: 0 }, { denom: "allBTC", exponent: 8 }] },
    // No display match in denom_units → decimals falls back to the largest exponent (8).
    { base: "factory/osmo1.../wbtc", symbol: "WBTC", name: "Wrapped Bitcoin", display: "wbtc", coingecko_id: "wrapped-bitcoin", denom_units: [{ denom: "factory/osmo1.../wbtc", exponent: 0 }, { denom: "sats", exponent: 8 }] },
  ],
};

const fetcher: AssetListFetcher = async () => assetList;

afterEach(() => {
  _clearCosmosRegistryCache();
});

describe("resolveCosmosAsset", () => {
  it("resolves a native denom to its canonical identity", async () => {
    expect(await resolveCosmosAsset("osmosis", OSMO, { fetcher })).toEqual({
      denom: OSMO, symbol: "OSMO", name: "Osmosis", decimals: 6, coingeckoCoinId: "osmosis",
    });
  });

  it("resolves an ibc denom (decimals from the display unit)", async () => {
    const atom = await resolveCosmosAsset("osmosis", ATOM, { fetcher });
    expect(atom?.symbol).toBe("ATOM");
    expect(atom?.decimals).toBe(6);
    expect(atom?.coingeckoCoinId).toBe("cosmos");
  });

  it("keys by denom, not symbol — same-symbol variants resolve to different coin ids", async () => {
    expect((await resolveCosmosAsset("osmosis", USDC, { fetcher }))?.coingeckoCoinId).toBe("usd-coin");
    expect((await resolveCosmosAsset("osmosis", AXLUSDC, { fetcher }))?.coingeckoCoinId).toBe("axlusdc");
  });

  it("returns an empty coingecko id for a non-overlay denom the registry lists without one", async () => {
    // DYDX is NOT in the blue-chip overlay (it's a niche alloyed asset), so it stays unidentified.
    const dydx = await resolveCosmosAsset("osmosis", DYDX_ALLOYED, { fetcher });
    expect(dydx?.symbol).toBe("DYDX");
    expect(dydx?.coingeckoCoinId).toBe("");
  });

  it("applies the blue-chip overlay to an alloyed synthetic the registry lists without a coingecko id", async () => {
    const btc = await resolveCosmosAsset("osmosis", "factory/osmo1.../alloyed/allBTC", { fetcher });
    expect(btc?.symbol).toBe("BTC");
    expect(btc?.coingeckoCoinId).toBe("bitcoin"); // overlay supplied it (registry had null)
  });

  it("falls back to the largest exponent when no denom_unit matches display", async () => {
    expect((await resolveCosmosAsset("osmosis", "factory/osmo1.../wbtc", { fetcher }))?.decimals).toBe(8);
  });

  it("returns null for a denom the registry doesn't list", async () => {
    expect(await resolveCosmosAsset("osmosis", "ibc/UNKNOWN", { fetcher })).toBeNull();
  });

  it("returns null for a chain with no registry mapping", async () => {
    expect(await resolveCosmosAsset("not-a-cosmos-chain", OSMO, { fetcher })).toBeNull();
  });
});

describe("cosmosAssetMap", () => {
  it("builds a denom-keyed map and memoises it (one fetch per chain)", async () => {
    let calls = 0;
    const counting: AssetListFetcher = async (dir) => {
      calls += 1;
      return dir === "osmosis" ? assetList : null;
    };
    const a = await cosmosAssetMap("osmosis", { fetcher: counting });
    const b = await cosmosAssetMap("osmosis", { fetcher: counting });
    expect(a.size).toBe(7);
    expect(b).toBe(a); // memoised — same map instance
    expect(calls).toBe(1);
  });

  it("returns an empty map for an unmapped chain without fetching", async () => {
    let calls = 0;
    const counting: AssetListFetcher = async () => {
      calls += 1;
      return assetList;
    };
    const map = await cosmosAssetMap("ethereum", { fetcher: counting });
    expect(map.size).toBe(0);
    expect(calls).toBe(0);
  });
});

describe("isCosmosRegistryChain", () => {
  it("knows osmosis is a registry chain and an EVM chain is not", () => {
    expect(isCosmosRegistryChain("osmosis")).toBe(true);
    expect(isCosmosRegistryChain("eth")).toBe(false);
  });
});
