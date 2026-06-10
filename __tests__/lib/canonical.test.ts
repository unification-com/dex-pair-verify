// Tests for lib/canonical.ts — the canonical-pair key (A.2).

import { describe, expect, it } from "vitest";
import { utils as web3Utils } from "web3";

import { canonicalKey, cgPlatformForChain, tokenContractsByChain } from "../../lib/canonical";

describe("canonicalKey", () => {
  it("builds min:max regardless of token order", () => {
    const forward = canonicalKey({
      token0: { coingeckoCoinId: "weth" },
      token1: { coingeckoCoinId: "usd-coin" },
    });
    const reversed = canonicalKey({
      token0: { coingeckoCoinId: "usd-coin" },
      token1: { coingeckoCoinId: "weth" },
    });
    // "usd-coin" < "weth" lexically, so both orders collapse to the same key.
    expect(forward).toBe("usd-coin:weth");
    expect(reversed).toBe("usd-coin:weth");
  });

  it("returns null when token0 has no coin id", () => {
    expect(
      canonicalKey({ token0: { coingeckoCoinId: "" }, token1: { coingeckoCoinId: "weth" } }),
    ).toBeNull();
  });

  it("returns null when token1 has no coin id", () => {
    expect(
      canonicalKey({ token0: { coingeckoCoinId: "weth" }, token1: { coingeckoCoinId: "" } }),
    ).toBeNull();
  });

  it("returns null when both coin ids are missing", () => {
    expect(
      canonicalKey({ token0: { coingeckoCoinId: "" }, token1: { coingeckoCoinId: "" } }),
    ).toBeNull();
  });

  it("treats null / undefined coin ids as missing", () => {
    expect(
      canonicalKey({ token0: { coingeckoCoinId: null }, token1: { coingeckoCoinId: "weth" } }),
    ).toBeNull();
    expect(
      canonicalKey({ token0: { coingeckoCoinId: "weth" }, token1: {} }),
    ).toBeNull();
  });

  it("treats null tokens as missing", () => {
    expect(
      canonicalKey({ token0: null, token1: { coingeckoCoinId: "weth" } }),
    ).toBeNull();
    expect(canonicalKey({})).toBeNull();
  });

  it("trims and lower-cases before keying", () => {
    expect(
      canonicalKey({
        token0: { coingeckoCoinId: "  WETH " },
        token1: { coingeckoCoinId: "USD-Coin" },
      }),
    ).toBe("usd-coin:weth");
  });

  it("treats whitespace-only coin ids as missing", () => {
    expect(
      canonicalKey({ token0: { coingeckoCoinId: "   " }, token1: { coingeckoCoinId: "weth" } }),
    ).toBeNull();
  });

  it("keys a same-coin pair to id:id", () => {
    expect(
      canonicalKey({
        token0: { coingeckoCoinId: "dai" },
        token1: { coingeckoCoinId: "dai" },
      }),
    ).toBe("dai:dai");
  });
});

describe("cgPlatformForChain", () => {
  it("maps known GeckoTerminal chain keys to CoinGecko asset-platform ids", () => {
    expect(cgPlatformForChain("eth")).toBe("ethereum");
    expect(cgPlatformForChain("polygon_pos")).toBe("polygon-pos");
    expect(cgPlatformForChain("bsc")).toBe("binance-smart-chain");
    expect(cgPlatformForChain("xdai")).toBe("xdai");
  });

  it("returns null for a chain not indexed by CoinGecko (qom)", () => {
    expect(cgPlatformForChain("qom")).toBeNull();
  });

  it("returns null for an unknown chain", () => {
    expect(cgPlatformForChain("solana")).toBeNull();
  });
});

describe("tokenContractsByChain", () => {
  const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
  const POLY_USDC = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";

  it("maps platform addresses to internal chains, checksummed", async () => {
    const fetcher = async () => ({ ethereum: WETH, "polygon-pos": POLY_USDC, "some-other-platform": WETH });
    const out = await tokenContractsByChain("weth", { fetcher });
    expect(out.eth).toBe(web3Utils.toChecksumAddress(WETH));
    expect(out.polygon_pos).toBe(web3Utils.toChecksumAddress(POLY_USDC));
    // chains the coin has no contract on are absent
    expect(out.bsc).toBeUndefined();
  });

  it("skips malformed addresses", async () => {
    const out = await tokenContractsByChain("weth", { fetcher: async () => ({ ethereum: "not-an-address" }) });
    expect(out.eth).toBeUndefined();
  });

  it("returns {} when the platforms fetch fails (null)", async () => {
    const out = await tokenContractsByChain("weth", { fetcher: async () => null });
    expect(out).toEqual({});
  });

  it("returns {} for an empty cgId without fetching", async () => {
    let called = false;
    const out = await tokenContractsByChain("", {
      fetcher: async () => {
        called = true;
        return {};
      },
    });
    expect(out).toEqual({});
    expect(called).toBe(false);
  });
});
