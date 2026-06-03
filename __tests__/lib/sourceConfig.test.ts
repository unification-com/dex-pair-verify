// Tests for lib/sourceConfig.ts — the typed accessors over lib/sources.js.

import { describe, expect, it } from "vitest";

import { getCanonicalFactoryAddress, getSourceByIndex, sourceCount } from "../../lib/sourceConfig";

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
