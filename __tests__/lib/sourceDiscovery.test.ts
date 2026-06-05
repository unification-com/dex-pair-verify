// Unit tests for the pure source-discovery diff (Phase 4, 4.A.1): GT (network,
// dex) keying, the already-supported set drawn from lib/sources.js, and the
// new-vs-known diff that keeps already-triaged candidates from re-surfacing.

import { describe, expect, it } from "vitest";

import {
  DISCOVERY_NETWORKS,
  discoveryKey,
  matchesTargetFamily,
  newSourcesForNetwork,
  supportedGtKeys,
} from "../../lib/sourceDiscovery";

describe("discoveryKey", () => {
  it("joins network and dex with a slash", () => {
    expect(discoveryKey("base", "aerodrome")).toBe("base/aerodrome");
  });
});

describe("supportedGtKeys", () => {
  it("includes wired sources by their GT slugs (defaulting network/dex to our ids)", () => {
    const keys = supportedGtKeys();
    expect(keys.has("eth/uniswap_v2")).toBe(true);
    expect(keys.has("eth/uniswap_v3")).toBe(true);
    expect(keys.has("polygon_pos/quickswap_v3")).toBe(true);
  });

  it("resolves the GT dex override, not the internal id", () => {
    const keys = supportedGtKeys();
    // bsc source's internal dex is bsc_pancakeswap_v3, but GT calls it pancakeswap-v3-bsc.
    expect(keys.has("bsc/pancakeswap-v3-bsc")).toBe(true);
    expect(keys.has("bsc/bsc_pancakeswap_v3")).toBe(false);
  });
});

describe("DISCOVERY_NETWORKS", () => {
  it("covers the EVM scope (supported + 4.D Tier-B) and excludes non-EVM", () => {
    for (const n of ["eth", "polygon_pos", "xdai", "bsc", "arbitrum", "base", "optimism", "avax"]) {
      expect(DISCOVERY_NETWORKS).toContain(n);
    }
    // Non-EVM is deferred until go-ooo can serve it.
    expect(DISCOVERY_NETWORKS).not.toContain("solana");
    expect(DISCOVERY_NETWORKS).not.toContain("osmosis");
  });
});

describe("matchesTargetFamily", () => {
  it("matches target families across slug variants (case-insensitive substring)", () => {
    expect(matchesTargetFamily("pancakeswap_v2")).toBe(true);
    expect(matchesTargetFamily("uniswap-v3-base")).toBe(true);
    expect(matchesTargetFamily("Aerodrome")).toBe(true);
    expect(matchesTargetFamily("velodrome-v2")).toBe(true);
  });

  it("rejects non-target DEXs (the long-tail noise)", () => {
    expect(matchesTargetFamily("mdex")).toBe(false);
    expect(matchesTargetFamily("ellipsis")).toBe(false);
    expect(matchesTargetFamily("apeswap")).toBe(false);
  });
});

describe("newSourcesForNetwork", () => {
  // A target/non-target mix on one network.
  const dexes = new Set(["uniswap_v3", "sushiswap", "aerodrome", "mdex", "ellipsis"]);

  it("curates to target families and excludes supported / already-triaged ones", () => {
    const supported = new Set(["base/uniswap_v3"]);
    const known = new Set(["base/sushiswap"]); // an existing candidate (any status)
    const fresh = newSourcesForNetwork("base", dexes, supported, known);
    // mdex/ellipsis filtered as non-target; uniswap_v3 supported; sushiswap known.
    expect(fresh).toEqual([{ gtNetwork: "base", gtDex: "aerodrome" }]);
  });

  it("surfaces every target family when nothing is supported or known", () => {
    const fresh = newSourcesForNetwork("base", dexes, new Set(), new Set());
    expect(fresh.map((s) => s.gtDex)).toEqual(["uniswap_v3", "sushiswap", "aerodrome"]);
  });

  it("with { all: true } bypasses the family filter (the full firehose)", () => {
    const fresh = newSourcesForNetwork("base", dexes, new Set(), new Set(), { all: true });
    expect(fresh.map((s) => s.gtDex)).toEqual(["uniswap_v3", "sushiswap", "aerodrome", "mdex", "ellipsis"]);
  });

  it("returns nothing when all target families are already accounted for", () => {
    const supported = new Set(["base/uniswap_v3", "base/sushiswap"]);
    const known = new Set(["base/aerodrome"]);
    expect(newSourcesForNetwork("base", dexes, supported, known)).toEqual([]);
  });
});
