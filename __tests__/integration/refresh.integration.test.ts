// Integration tests for the refresh of unseen pairs (lib/pipeline.ts refreshUnseenPass +
// lib/ingest.ts ingestPoolsByAddress) and the verdict's unseen rule: a verified pair the page ingest
// stopped returning is re-fetched by address; one GeckoTerminal no longer returns ages out of OoO
// pricing, and comes back by itself once it is returned again.

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, seedPair, seedSource, seedToken, testPrisma } from "./helpers";
import { ingestPoolPage, ingestPoolsByAddress } from "../../lib/ingest";
import { refreshUnseenPass } from "../../lib/pipeline";
import { VERDICT_REASON } from "../../lib/verdict";
import { runVerdictForPair } from "../../lib/verdictRunner";
import { TokenPairStatus } from "../../types/types";

import type { PoolsByAddressFetcher } from "../../lib/gtAdapter";

const NOW = 1_700_000_000;
const DAY = 86_400;
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const POOL = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";

const gtPool = (address: string) => ({
  attributes: {
    address,
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
});

const gtTokens = () => [
  { attributes: { address: WETH, name: "Wrapped Ether", symbol: "WETH", decimals: 18, coingecko_coin_id: "weth", price_usd: "2000" } },
  { attributes: { address: USDC, name: "USD Coin", symbol: "USDC", decimals: 6, coingecko_coin_id: "usd-coin", price_usd: "1" } },
];

// Stub multi-pool endpoint: records each call, returns the pools in `live` among those asked for.
const multi = (live: string[]) => {
  const calls: string[][] = [];
  const fetcher: PoolsByAddressFetcher = async (_network, addresses) => {
    calls.push(addresses);
    const found = addresses.filter((a) => live.includes(a));
    return { pools: found.map(gtPool), tokens: found.length ? gtTokens() : [] } as never;
  };
  return { fetcher, calls };
};

const pairRow = () => testPrisma.pair.findFirstOrThrow({ where: { chain: "eth", dex: "uniswap_v3", contractAddress: POOL } });

beforeEach(async () => {
  await resetDb();
  await seedSource({ chain: "eth", dex: "uniswap_v3" });
  await testPrisma.canonicalAddress.createMany({
    data: [
      { coingeckoCoinId: "weth", chain: "eth", contractAddress: WETH, lastChecked: NOW },
      { coingeckoCoinId: "usd-coin", chain: "eth", contractAddress: USDC, lastChecked: NOW },
    ],
  });
  // The page ingest last returned the pool 20 days ago, when it verified.
  await ingestPoolPage("eth", "uniswap_v3", 1, {
    now: NOW - 20 * DAY,
    poolFetcher: async () => ({ pools: [gtPool(POOL)], tokens: gtTokens() }) as never,
  });
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("unseen pairs", () => {
  it("re-fetches a verified pair the page ingest no longer returns, keeping it fresh and verified", async () => {
    expect((await pairRow()).status).toBe(TokenPairStatus.AutoVerified);
    const { fetcher, calls } = multi([POOL]);

    const s = await refreshUnseenPass({ since: NOW, now: NOW, fetcher });

    expect(calls).toEqual([[POOL]]);
    expect(s).toMatchObject({ requested: 1, returned: 1 });
    expect(await pairRow()).toMatchObject({ lastChecked: NOW, status: TokenPairStatus.AutoVerified });
  });

  it("takes a pair GeckoTerminal stops returning out of OoO pricing, and puts it back when it returns", async () => {
    // GeckoTerminal no longer returns it: nothing changes, it just stays unseen.
    expect(await refreshUnseenPass({ since: NOW, now: NOW, fetcher: multi([]).fetcher })).toMatchObject({ requested: 1, returned: 0 });
    expect((await pairRow()).lastChecked).toBe(NOW - 20 * DAY);

    // Revalidate judges it unseen for too long.
    await runVerdictForPair((await pairRow()).id, { now: NOW });
    const out = await pairRow();
    expect(out.status).toBe(TokenPairStatus.AutoRejected);
    expect((out.verdictEvidence as { reasonCode?: string }).reasonCode).toBe(VERDICT_REASON.unseenTooLong);

    // The next run still asks for it, and once it is returned it is verified again.
    const s = await refreshUnseenPass({ since: NOW + DAY, now: NOW + DAY, fetcher: multi([POOL]).fetcher });
    expect(s).toMatchObject({ requested: 1, returned: 1 });
    expect(await pairRow()).toMatchObject({ lastChecked: NOW + DAY, status: TokenPairStatus.AutoVerified });
  });

  it("asks only for unseen verified pairs and recently unseen-rejected ones on EVM sources", async () => {
    const t0 = await seedToken();
    const t1 = await seedToken();
    const reasoned = (reasonCode: string) => ({ verdictEvidence: { reasonCode } });
    const seed = (contractAddress: string, over: Parameters<typeof seedPair>[2]) =>
      seedPair(t0.id, t1.id, { contractAddress, ...over });
    await seed("0xSEEN", { status: TokenPairStatus.AutoVerified, lastChecked: NOW + 10 }); // seen this run
    await seed("0xTHIN", { status: TokenPairStatus.AutoRejected, lastChecked: NOW - 20 * DAY, ...reasoned(VERDICT_REASON.liquidityBelowHardFloor) });
    await seed("0xRECENT", { status: TokenPairStatus.AutoRejected, lastChecked: NOW - 100 * DAY, ...reasoned(VERDICT_REASON.unseenTooLong) });
    await seed("0xLONGGONE", { status: TokenPairStatus.AutoRejected, lastChecked: NOW - 130 * DAY, ...reasoned(VERDICT_REASON.unseenTooLong) });
    await seedSource({ chain: "osmosis", dex: "osmosis_sqs", sourceType: "rest-sqs", subgraphUrlTemplate: "https://sqs.test" });
    await seedPair(t0.id, t1.id, { chain: "osmosis", dex: "osmosis_sqs", contractAddress: "1", status: TokenPairStatus.AutoVerified, lastChecked: NOW - 20 * DAY });

    const { fetcher, calls } = multi([]);
    await refreshUnseenPass({ since: NOW, now: NOW, fetcher });

    expect(calls.flat().sort()).toEqual(["0xRECENT", POOL].sort());
  });
});

describe("ingestPoolsByAddress", () => {
  it("asks GeckoTerminal for at most 30 pools a call", async () => {
    const addresses = Array.from({ length: 31 }, (_, i) => `0x${i.toString(16).padStart(40, "0")}`);
    const { fetcher, calls } = multi([]);
    const r = await ingestPoolsByAddress("eth", "uniswap_v3", addresses, { now: NOW, fetcher });
    expect(calls.map((c) => c.length)).toEqual([30, 1]);
    expect(r).toMatchObject({ requested: 31, returned: 0 });
  });
});
