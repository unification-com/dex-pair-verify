// Tests for lib/poolPrice.ts: the Uniswap price convention and the sqrtPrice conversion
// (the same numbers as go-ooo's uniswap family tests).
import { describe, expect, it } from "vitest";

import { sqrtPriceToToken1PerToken0, uniswapPrices } from "../../lib/poolPrice";

// sqrtPrice 2^96 is a raw price of 1, so token1 per token0 is 10^(decimals0 - decimals1).
const ONE = "79228162514264337593543950336";

describe("sqrtPriceToToken1PerToken0", () => {
  it("prices a live Pharaoh v3 WAVAX(18)/USDC(6) pool (GeckoTerminal: 8.5194)", () => {
    expect(sqrtPriceToToken1PerToken0("231326762176403495006056", 18, 6)).toBeCloseTo(8.524964729717242, 10);
  });
  it("scales by the decimals difference either way", () => {
    expect(sqrtPriceToToken1PerToken0(ONE, 18, 6)).toBeCloseTo(1e12, 0);
    expect(sqrtPriceToToken1PerToken0(ONE, 6, 18) / 1e-12).toBeCloseTo(1, 12);
  });
  it("is 0 for a pool with no price yet", () => {
    expect(sqrtPriceToToken1PerToken0("0", 18, 18)).toBe(0);
  });
});

describe("uniswapPrices", () => {
  it("token1Price is token1 per token0 and token0Price its inverse", () => {
    // WETH(token0)/USDC(token1) at 2000 USDC per WETH.
    expect(uniswapPrices(2000)).toEqual({ token0Price: "0.0005", token1Price: "2000" });
  });
});
