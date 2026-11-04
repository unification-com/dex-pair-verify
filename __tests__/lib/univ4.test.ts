// Tests for lib/univ4.ts — the shared Uniswap-v4 helpers: poolId-aware address resolution,
// hooks detection, and native-currency (0x0) → wrapped-token normalisation.

import { describe, expect, it } from "vitest";

import {
  isHookedPool,
  isNativeCurrency,
  normaliseV4Symbol,
  poolAddressFromGt,
  wrappedNativeSymbol,
  wrappedNativeToken,
  ZERO_ADDRESS,
} from "../../lib/univ4";

const POOL_ID = "0x00b9edc1583bf6ef09ff3a09f6c23ecb57fd7d0bb75625717ec81eed181e22d7"; // real v4 ETH/USDC poolId
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

describe("poolAddressFromGt", () => {
  it("passes a 32-byte v4 poolId through, lower-cased (toChecksumAddress would throw on it)", () => {
    expect(poolAddressFromGt(POOL_ID)).toBe(POOL_ID);
    expect(poolAddressFromGt(POOL_ID.toUpperCase().replace("0X", "0x"))).toBe(POOL_ID);
  });
  it("checksums a 20-byte v2/v3 pool address", () => {
    expect(poolAddressFromGt(WETH.toLowerCase())).toBe(WETH);
  });
  it("returns null for junk / empty / nullish", () => {
    expect(poolAddressFromGt("0xabc")).toBeNull();
    expect(poolAddressFromGt("not-an-address")).toBeNull();
    expect(poolAddressFromGt("")).toBeNull();
    expect(poolAddressFromGt(null)).toBeNull();
    expect(poolAddressFromGt(undefined)).toBeNull();
  });
});

describe("isHookedPool", () => {
  it("zero address (or empty) is no-hook; anything else is hooked", () => {
    expect(isHookedPool(ZERO_ADDRESS)).toBe(false);
    expect(isHookedPool("0x0000000000000000000000000000000000000000")).toBe(false);
    expect(isHookedPool("")).toBe(false);
    expect(isHookedPool(null)).toBe(false);
    expect(isHookedPool("0x13ba8523f62decaee6489464935fbd8c3f505080")).toBe(true);
  });
});

describe("isNativeCurrency", () => {
  it("true only for the zero address (case-insensitive)", () => {
    expect(isNativeCurrency(ZERO_ADDRESS)).toBe(true);
    expect(isNativeCurrency("0x0000000000000000000000000000000000000000")).toBe(true);
    expect(isNativeCurrency(WETH)).toBe(false);
    expect(isNativeCurrency("")).toBe(false);
  });
});

describe("wrappedNativeSymbol / wrappedNativeToken", () => {
  it("maps eth's native currency to WETH with the 'weth' CoinGecko id", () => {
    expect(wrappedNativeSymbol("eth")).toBe("WETH");
    const t = wrappedNativeToken("eth");
    expect(t).not.toBeNull();
    expect(t?.address).toBe(WETH);
    expect(t?.symbol).toBe("WETH");
    expect(t?.coingeckoCoinId).toBe("weth");
    expect(t?.decimals).toBe(18);
  });
  it("returns null token mapping for a chain not yet brought online (fail-safe)", () => {
    expect(wrappedNativeToken("some_unmapped_chain")).toBeNull();
  });
});

describe("normaliseV4Symbol", () => {
  it("rewrites native ETH (id 0x0) to the chain's wrapped symbol", () => {
    expect(normaliseV4Symbol("eth", ZERO_ADDRESS, "ETH")).toBe("WETH");
  });
  it("leaves non-native tokens unchanged", () => {
    expect(normaliseV4Symbol("eth", WETH, "WETH")).toBe("WETH");
    expect(normaliseV4Symbol("eth", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "USDC")).toBe("USDC");
  });
  it("leaves native unchanged on a chain with no wrapped mapping (so it fails to key, the safe default)", () => {
    expect(normaliseV4Symbol("some_unmapped_chain", ZERO_ADDRESS, "ETH")).toBe("ETH");
  });
});
