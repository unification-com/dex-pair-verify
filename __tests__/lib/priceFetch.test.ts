// Tests for lib/priceFetch.ts toPoolPriceRow: each family's subgraph row as a price row in the
// Uniswap convention (token0Price = token0 per token1), which the price test orients by the
// target's side (components/PriceTest/PriceData.tsx targetPrice).
import { describe, expect, it } from "vitest";

import { toPoolPriceRow } from "../../lib/priceFetch";

const ZERO = "0x0000000000000000000000000000000000000000";
const weth = { id: "0xweth", symbol: "WETH" };
const usdc = { id: "0xusdc", symbol: "USDC" };

describe("toPoolPriceRow", () => {
  it("passes univ2/univ3 prices through", () => {
    const r = toPoolPriceRow("eth", "uniswap_v3", "univ3", { id: "0xp", token0: weth, token1: usdc, token0Price: "0.0005", token1Price: "2000" });
    expect(r).toMatchObject({ token0Symbol: "WETH", token1Symbol: "USDC", token0Price: "0.0005", token1Price: "2000", pairContractAddress: "0xp" });
  });

  it("derives messari prices so WETH/USDC prices WETH in USDC on token1Price", () => {
    const r = toPoolPriceRow("arbitrum", "sushiswap", "messari", {
      id: "0xm",
      inputTokens: [{ ...weth, lastPriceUSD: "2000" }, { ...usdc, lastPriceUSD: "1" }],
    });
    expect(r).toMatchObject({ token0Symbol: "WETH", token1Symbol: "USDC", token0Price: "0.0005", token1Price: "2000" });
  });

  it("skips a messari pool missing a token price", () => {
    expect(toPoolPriceRow("arbitrum", "sushiswap", "messari", { id: "0xm", inputTokens: [{ ...weth, lastPriceUSD: "0" }, { ...usdc, lastPriceUSD: "1" }] })).toBeNull();
  });

  it("derives univ3sqrt prices from sqrtPrice and decimals (live Pharaoh v3 WAVAX/USDC)", () => {
    const r = toPoolPriceRow("avax", "pharaoh_v3", "univ3sqrt", {
      id: "0xf01449c0ba930b6e2caca3def3ccbd7a3e589534",
      token0: { id: "0xwavax", symbol: "WAVAX", decimals: "18" },
      token1: { id: "0xusdc", symbol: "USDC", decimals: "6" },
      sqrtPrice: "231326762176403495006056",
    });
    expect(Number(r?.token1Price)).toBeCloseTo(8.524964729717242, 10);
    expect(Number(r?.token0Price)).toBeCloseTo(0.11730253809896622, 12);
  });

  it("skips a univ3sqrt pool with no price yet", () => {
    const t = { decimals: "18" };
    expect(toPoolPriceRow("avax", "pharaoh_v3", "univ3sqrt", { id: "0xs", token0: { ...weth, ...t }, token1: { ...usdc, ...t }, sqrtPrice: "0" })).toBeNull();
  });

  it("skips a hooked univ4 pool and normalises native ETH to WETH on an unhooked one", () => {
    const pool = { id: "0x4", token0: { id: ZERO, symbol: "ETH" }, token1: usdc, token0Price: "0.0005", token1Price: "2000" };
    expect(toPoolPriceRow("eth", "uniswap_v4", "univ4", { ...pool, hooks: "0x1234" })).toBeNull();
    expect(toPoolPriceRow("eth", "uniswap_v4", "univ4", { ...pool, hooks: ZERO })?.token0Symbol).toBe("WETH");
  });
});
