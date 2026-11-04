// Tests for lib/aliasGroups.ts — the asset-class alias curation (T13). Locks in BOTH the fungible
// members AND the safety-critical exclusions (a wrong member poisons every class price that uses it),
// plus the no-overlap invariant.
import { describe, expect, it } from "vitest";

import { ALIAS_GROUPS, aliasForCgId, aliasPairForCanonicalKey, aliasPairLabel, isAliasSymbol, membersOfAlias, targetSideSymbol } from "../../lib/aliasGroups";

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

  it("derives the cross-class alias-pair a canonical key backs", () => {
    expect(aliasPairForCanonicalKey("ethereum:usd-coin")).toBe("ETH.USD");
    expect(aliasPairForCanonicalKey("tether:weth")).toBe("ETH.USD"); // sorted regardless of cg order
    expect(aliasPairForCanonicalKey("bitcoin:usd-coin")).toBe("BTC.USD");
    expect(aliasPairForCanonicalKey("weth:wrapped-bitcoin")).toBe("BTC.ETH"); // alias symbols sorted
  });

  it("returns null for non-alias-pair canonical keys", () => {
    expect(aliasPairForCanonicalKey("tether:usd-coin")).toBeNull();   // both USD — same class, not a pair
    expect(aliasPairForCanonicalKey("ethereum:some-random-token")).toBeNull(); // one side unmapped
    expect(aliasPairForCanonicalKey("just-one-part")).toBeNull();     // malformed
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

describe("aliasPairLabel", () => {
  it("labels a query only when BOTH sides are alias classes — order/case-independent", () => {
    expect(aliasPairLabel("ETH", "USD")).toBe("ETH.USD");
    expect(aliasPairLabel("USD", "ETH")).toBe("ETH.USD"); // sorted regardless of query order
    expect(aliasPairLabel("btc", "eth")).toBe("BTC.ETH"); // case-insensitive
    expect(aliasPairLabel("USD", "BTC")).toBe("BTC.USD");
  });

  it("returns null when either side is a concrete token symbol", () => {
    expect(aliasPairLabel("WETH", "USDC")).toBeNull(); // neither is a class
    expect(aliasPairLabel("ETH", "WETH")).toBeNull(); // WETH is a token, not a class
    expect(aliasPairLabel("ETH", "USDC")).toBeNull(); // mixed — go-ooo S7 needs both alias
  });
});

describe("targetSideSymbol", () => {
  const usdc = { symbol: "USDC", coingeckoCoinId: "usd-coin" };
  const usdt = { symbol: "USDT", coingeckoCoinId: "tether" };
  const weth = { symbol: "WETH", coingeckoCoinId: "weth" };

  it("returns the query target verbatim for a non-alias (exact) query", () => {
    expect(targetSideSymbol({ token0: weth, token1: usdc }, "USDC", false)).toBe("USDC");
  });

  it("orients an alias query to the pool's class token regardless of which side it sits on", () => {
    // The bug: a literal "USD" never equals "USDC", so the old symbol-match defaulted every pool to
    // one side. Orientation must follow the cg-id class, whichever index the dollar token holds.
    expect(targetSideSymbol({ token0: usdc, token1: weth }, "USD", true)).toBe("USDC"); // USD at token0
    expect(targetSideSymbol({ token0: weth, token1: usdc }, "USD", true)).toBe("USDC"); // USD at token1
    expect(targetSideSymbol({ token0: weth, token1: usdt }, "USD", true)).toBe("USDT"); // a different stable
    expect(targetSideSymbol({ token0: usdc, token1: weth }, "ETH", true)).toBe("WETH"); // target the ETH side
  });

  it("falls back to the query target when no token is in the class", () => {
    expect(targetSideSymbol({ token0: weth, token1: usdc }, "BTC", true)).toBe("BTC");
    expect(targetSideSymbol({ token0: null, token1: null }, "USD", true)).toBe("USD");
  });
});
