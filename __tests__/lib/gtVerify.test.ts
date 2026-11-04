// Unit tests for the pure verifySource (GeckoTerminal slug verification, A.4/Phase 4).

import { describe, expect, it } from "vitest";

import { NetworkDexes, verifySource } from "../../lib/gtVerify";

const net = (arr: string[]): NetworkDexes => ({ found: true, dexes: new Set(arr) });

describe("verifySource", () => {
  it("passes when the GT dex slug exists on the network", () => {
    const v = verifySource(
      { chain: "eth", dex: "uniswap_v3" },
      { eth: net(["uniswap_v2", "uniswap_v3"]) },
    );
    expect(v.networkOk).toBe(true);
    expect(v.dexOk).toBe(true);
  });

  it("uses the gtDex override for the lookup", () => {
    const v = verifySource(
      { chain: "bsc", dex: "bsc_pancakeswap_v3", gtDex: "pancakeswap-v3-bsc" },
      { bsc: net(["pancakeswap-v3-bsc", "pancakeswap_v2"]) },
    );
    expect(v.dexOk).toBe(true);
    expect(v.gtDex).toBe("pancakeswap-v3-bsc");
  });

  it("fails and suggests candidates when the slug is missing", () => {
    const v = verifySource(
      { chain: "bsc", dex: "bsc_pancakeswap_v3" },
      { bsc: net(["pancakeswap-v3-bsc", "pancakeswap_v2"]) },
    );
    expect(v.dexOk).toBe(false);
    expect(v.candidates).toContain("pancakeswap-v3-bsc");
  });

  it("flags a network that isn't on GeckoTerminal", () => {
    const v = verifySource(
      { chain: "qom", dex: "qomswap_v2" },
      { qom: { found: false, dexes: new Set() } },
    );
    expect(v.networkOk).toBe(false);
    expect(v.dexOk).toBe(false);
  });
});
