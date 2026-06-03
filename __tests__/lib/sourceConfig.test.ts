// Tests for lib/sourceConfig.ts — the typed accessors over lib/sources.js.

import { describe, expect, it } from "vitest";

import { getCanonicalFactoryAddress, getSourceByIndex, sourceCount, thresholdSeedData } from "../../lib/sourceConfig";

describe("getCanonicalFactoryAddress", () => {
  it("returns the verified canonical factory for a known source", () => {
    expect(getCanonicalFactoryAddress("eth", "uniswap_v3")).toBe("0x1F98431c8aD98523631AE4a59f267346ea31F984");
    expect(getCanonicalFactoryAddress("bsc", "bsc_pancakeswap_v3")).toBe("0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865");
  });

  it("returns null for the operator-TODO qomswap factory (empty string)", () => {
    expect(getCanonicalFactoryAddress("qom", "qomswap_v2")).toBeNull();
  });

  it("returns null for an unknown source", () => {
    expect(getCanonicalFactoryAddress("eth", "not-a-dex")).toBeNull();
  });
});

describe("source indexing", () => {
  it("reports a positive source count and indexes in range", () => {
    expect(sourceCount).toBeGreaterThan(0);
    const first = getSourceByIndex(0);
    expect(first?.chain).toBeTruthy();
    expect(first?.dex).toBeTruthy();
  });

  it("returns undefined for an out-of-range index", () => {
    expect(getSourceByIndex(9999)).toBeUndefined();
  });
});

describe("thresholdSeedData", () => {
  it("applies a source's A.8 matrix floors (deep venue)", () => {
    const seed = thresholdSeedData("bsc", "bsc_pancakeswap_v3");
    expect(seed).toMatchObject({
      chain: "bsc",
      dex: "bsc_pancakeswap_v3",
      minLiquidityUsd: 35000,
      hardMinLiquidityUsd: 5000,
      minTxCount: 5,
    });
  });

  it("applies the thin-venue floors", () => {
    const seed = thresholdSeedData("xdai", "honeyswap");
    expect(seed.minLiquidityUsd).toBe(5000);
    expect(seed.hardMinLiquidityUsd).toBe(2000);
  });

  it("omits hardMinLiquidityUsd for a source without matrix floors (schema default applies)", () => {
    const seed = thresholdSeedData("qom", "qomswap_v2");
    expect(seed.minLiquidityUsd).toBe(0);
    expect(seed.minTxCount).toBe(0);
    expect(seed).not.toHaveProperty("hardMinLiquidityUsd");
  });

  it("falls back to a bare-zero seed for an unknown source", () => {
    const seed = thresholdSeedData("eth", "not-a-dex");
    expect(seed).toEqual({ chain: "eth", dex: "not-a-dex", minLiquidityUsd: 0, minTxCount: 0 });
  });
});
