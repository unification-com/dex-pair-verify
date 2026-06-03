// Integration tests for lib/ingest.ts — the GeckoTerminal-only ingest. GT HTTP
// is stubbed via injectable fetchers; a fresh CanonicalAddress cache makes the
// inline verdict's canonical lookup a cache hit (no network).

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, testPrisma } from "./helpers";
import { ingestPoolPage } from "../../lib/ingest";
import { TokenPairStatus, VerificationMethod } from "../../types/types";

const NOW = 1_700_000_000;
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

const onePool = () => [
  {
    attributes: {
      address: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640", // a real uni v3 pool addr
      reserve_in_usd: "1000000",
      market_cap_usd: "5000000",
      pool_created_at: "2023-01-01T00:00:00Z",
      base_token_price_usd: "2000",
      quote_token_price_usd: "1",
      price_change_percentage: { h24: "1.5" },
      transactions: { h24: { buys: 100, sells: 80, buyers: 50, sellers: 40 } },
      volume_usd: { h24: "500000" },
    },
    relationships: {
      base_token: { data: { id: `eth_${WETH}` } },
      quote_token: { data: { id: `eth_${USDC}` } },
    },
  },
];

const tokensFor = () => [
  {
    attributes: {
      address: WETH, name: "Wrapped Ether", symbol: "WETH", decimals: 18,
      coingecko_coin_id: "weth", price_usd: "2000", market_cap_usd: "9000000000",
      total_supply: "1000000", volume_usd: { h24: "100000000" },
    },
  },
  {
    attributes: {
      address: USDC, name: "USD Coin", symbol: "USDC", decimals: 6,
      coingecko_coin_id: "usd-coin", price_usd: "1", market_cap_usd: "30000000000",
      total_supply: "30000000000", volume_usd: { h24: "200000000" },
    },
  },
];

async function seedCanonical() {
  await testPrisma.canonicalAddress.createMany({
    data: [
      { coingeckoCoinId: "weth", chain: "eth", contractAddress: WETH, lastChecked: NOW },
      { coingeckoCoinId: "usd-coin", chain: "eth", contractAddress: USDC, lastChecked: NOW },
    ],
  });
}

const opts = () => ({
  now: NOW,
  poolFetcher: async () => ({ pools: onePool(), tokens: tokensFor() }) as never,
});

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("ingestPoolPage", () => {
  it("hydrates tokens + pair from GeckoTerminal and runs the verdict inline", async () => {
    await seedCanonical();

    const result = await ingestPoolPage("eth", "uniswap_v3", 1, opts());

    expect(result.hadData).toBe(true);
    expect(result.pairs).toBe(1);
    expect(result.tallies[TokenPairStatus.AutoVerified]).toBe(1);

    const weth = await testPrisma.token.findFirst({ where: { contractAddress: WETH } });
    expect(weth?.symbol).toBe("WETH");
    expect(weth?.decimals).toBe(18);
    expect(weth?.coingeckoCoinId).toBe("weth");
    expect(weth?.deploymentTimestamp).toBe(Math.floor(Date.parse("2023-01-01T00:00:00Z") / 1000));

    const pair = await testPrisma.pair.findFirst({ where: { chain: "eth", dex: "uniswap_v3" } });
    expect(pair?.reserveUsd).toBe(1_000_000);
    expect(pair?.txCount).toBe(180); // buys + sells
    expect(pair?.token0PriceDex).toBe(2000);
    expect(pair?.token0PriceCg).toBe(2000);
    expect(pair?.status).toBe(TokenPairStatus.AutoVerified);
    expect(pair?.canonicalKey).toBe("usd-coin:weth");
    expect(pair?.verificationMethod).toBe(VerificationMethod.Auto);
  });

  it("reports hadData=false for an empty page (end of pagination)", async () => {
    const result = await ingestPoolPage("eth", "uniswap_v3", 99, {
      ...opts(),
      poolFetcher: async () => ({ pools: [], tokens: [] }) as never,
    });
    expect(result.hadData).toBe(false);
    expect(result.pairs).toBe(0);
  });

  it("is idempotent — re-ingesting updates rather than duplicating", async () => {
    await seedCanonical();
    await ingestPoolPage("eth", "uniswap_v3", 1, opts());
    await ingestPoolPage("eth", "uniswap_v3", 1, opts());

    expect(await testPrisma.pair.count()).toBe(1);
    expect(await testPrisma.token.count()).toBe(2);
  });

  it("skips a pool when GeckoTerminal returns no token data for it", async () => {
    const result = await ingestPoolPage("eth", "uniswap_v3", 1, {
      ...opts(),
      poolFetcher: async () => ({ pools: onePool(), tokens: [] }) as never, // no token data
    });
    expect(result.pairs).toBe(0);
    expect(await testPrisma.pair.count()).toBe(0);
  });
});
