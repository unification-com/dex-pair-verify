// Tests for lib/aliasGroups.ts — the asset-class alias curation (T13). Locks in BOTH the fungible
// members AND the safety-critical exclusions (a wrong member poisons every class price that uses it),
// plus the no-overlap invariant.
import { describe, expect, it } from "vitest";

import { ALIAS_GROUPS, aliasForCgId, isAliasSymbol, membersOfAlias } from "../../lib/aliasGroups";

describe("aliasGroups", () => {
  it("maps fungible members to their class", () => {
    expect(aliasForCgId("usd-coin")).toBe("USD");
    expect(aliasForCgId("tether")).toBe("USD");
    expect(aliasForCgId("bridged-usd-coin-base")).toBe("USD"); // a distinct-cg-id bridged USDC
    expect(aliasForCgId("ethereum")).toBe("ETH");
    expect(aliasForCgId("weth")).toBe("ETH");
    expect(aliasForCgId("arbitrum-bridged-weth-arbitrum-one")).toBe("ETH"); // 1:1 bridged WETH
    expect(aliasForCgId("bitcoin")).toBe("BTC");
    expect(aliasForCgId("wrapped-bitcoin")).toBe("BTC");
    expect(aliasForCgId("coinbase-wrapped-btc")).toBe("BTC");
  });

  it("EXCLUDES non-fungible look-alikes (the trust boundary)", () => {
    // Staked / restaked / yield-bearing ETH derivatives — trade off-peg, a different asset.
    for (const cg of ["wrapped-steth", "coinbase-wrapped-staked-eth", "rocket-pool-eth", "renzo-restaked-eth", "ether-fi-staked-eth", "frax-ether"]) {
      expect(aliasForCgId(cg)).toBeNull();
    }
    // Staked BTC, algorithmic / synthetic / dead stables, and the GOLD false-friend.
    for (const cg of ["lombard-staked-btc", "ethena-usde", "ethena-staked-usde", "terrausd", "tether-gold", "frax"]) {
      expect(aliasForCgId(cg)).toBeNull();
    }
  });

  it("normalises case + whitespace", () => {
    expect(aliasForCgId("WETH")).toBe("ETH");
    expect(aliasForCgId("  Wrapped-Bitcoin ")).toBe("BTC");
    expect(aliasForCgId("")).toBeNull();
    expect(aliasForCgId(null)).toBeNull();
  });

  it("recognises alias symbols (class names), not token symbols", () => {
    expect(isAliasSymbol("ETH")).toBe(true);
    expect(isAliasSymbol("eth")).toBe(true);
    expect(isAliasSymbol("BTC")).toBe(true);
    expect(isAliasSymbol("USD")).toBe(true);
    expect(isAliasSymbol("WETH")).toBe(false); // a token symbol, not a class
    expect(isAliasSymbol("USDC")).toBe(false);
  });

  it("lists a class's members", () => {
    expect(membersOfAlias("BTC")).toContain("bitcoin");
    expect(membersOfAlias("BTC")).toContain("wrapped-bitcoin");
    expect(membersOfAlias("NOPE")).toEqual([]);
  });

  it("holds the no-overlap invariant (no cg id in two classes)", () => {
    const seen = new Set<string>();
    for (const cgIds of Object.values(ALIAS_GROUPS)) {
      for (const cg of cgIds) {
        expect(seen.has(cg)).toBe(false);
        seen.add(cg);
      }
    }
  });
});
