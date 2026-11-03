// lib/poolPrice.ts
// Pool price conversions for families whose subgraph doesn't report token0Price/token1Price.

// A pool's two prices in the Uniswap convention, from token1 per token0: token0Price is token0
// per token1 and token1Price is token1 per token0.
export const uniswapPrices = (token1PerToken0: number): { token0Price: string; token1Price: string } => ({
  token0Price: String(1 / token1PerToken0),
  token1Price: String(token1PerToken0),
});

const Q96 = 2 ** 96;

// token1 per token0 from a Uniswap-v3-style sqrtPrice (sqrt(token1/token0) in raw token units, as
// a Q64.96 fixed-point number): (sqrtPrice / 2^96)^2 x 10^(decimals0 - decimals1). Mirrors
// go-ooo's uniswap family sqrtPriceFor. 0 for a pool with no price yet.
export function sqrtPriceToToken1PerToken0(sqrtPrice: string, decimals0: number, decimals1: number): number {
  const ratio = Number(sqrtPrice) / Q96;
  return ratio * ratio * 10 ** (decimals0 - decimals1);
}
