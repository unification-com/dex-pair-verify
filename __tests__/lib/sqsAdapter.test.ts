// Tests for lib/sqsAdapter.ts — the Osmosis SQS ingest adapter: discovery of 2-asset, chain-registry-
// identified pools from a stubbed SQS pool set, normalised to the source-neutral pool/token shape.
// The chain-registry is stubbed via the memoised cache; the SQS pools + prices transports are
// injected through the request.

import { afterEach, describe, expect, it } from "vitest";

import { cosmosAssetMap, _clearCosmosRegistryCache } from "../../lib/cosmosRegistry";
import { PoolPageRequest } from "../../lib/ingestAdapter";
import { SqsPool, SqsPoolsFetcher, SqsPricesFetcher } from "../../lib/sqs";
import { sqsAdapter } from "../../lib/sqsAdapter";

const OSMO = "uosmo";
const ATOM = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";
const USDC = "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4";
const JUNK = "ibc/UNLISTED0000000000000000000000000000000000000000000000000000";

const REGISTRY = {
  assets: [
    { base: OSMO, symbol: "OSMO", name: "Osmosis", display: "osmo", coingecko_id: "osmosis", denom_units: [{ denom: OSMO, exponent: 0 }, { denom: "osmo", exponent: 6 }] },
    { base: ATOM, symbol: "ATOM", name: "Cosmos Hub Atom", display: "atom", coingecko_id: "cosmos", denom_units: [{ denom: ATOM, exponent: 0 }, { denom: "atom", exponent: 6 }] },
    { base: USDC, symbol: "USDC", name: "USDC", display: "usdc", coingecko_id: "usd-coin", denom_units: [{ denom: USDC, exponent: 0 }, { denom: "usdc", exponent: 6 }] },
  ],
};

const bal = (denom: string, amount = "1") => ({ denom, amount });

const POOLS: SqsPool[] = [
  // OSMO/USDC — USDC listed first to prove orientation flips the stable to the quote.
  { type: 1, liquidity_cap: "1000000", fees_data: { volume_24h: 50000 }, balances: [bal(USDC), bal(OSMO)], chain_model: { pool_id: 1 } },
  // A shallower OSMO/USDC pool — deduped out in favour of pool 1.
  { type: 1, liquidity_cap: "500000", fees_data: { volume_24h: 9 }, balances: [bal(OSMO), bal(USDC)], chain_model: { pool_id: 2 } },
  // ATOM/OSMO — neither side is a stable, so the pool's own order is kept.
  { type: 0, liquidity_cap: "800000", fees_data: { volume_24h: 30000 }, balances: [bal(ATOM), bal(OSMO)], chain_model: { pool_id: 3 } },
  // Multi-asset transmuter — skipped (breaks the pair abstraction).
  { type: 3, liquidity_cap: "9000000", balances: [bal(OSMO), bal(ATOM), bal(USDC)], chain_model: { pool_id: 4 } },
  // A pool with an unlisted denom — skipped (not chain-registry-identified).
  { type: 1, liquidity_cap: "700000", balances: [bal(JUNK), bal(OSMO)], chain_model: { pool_id: 5 } },
  // A 2-asset pool with no pool id — skipped.
  { type: 1, liquidity_cap: "600000", balances: [bal(OSMO), bal(USDC)], chain_model: {} },
];

const poolsFetcher: SqsPoolsFetcher = async () => POOLS;
const pricesFetcher: SqsPricesFetcher = async (_url, denoms) => {
  const table: Record<string, number> = { [OSMO]: 0.047, [USDC]: 1, [ATOM]: 1.99 };
  return new Map(denoms.filter((d) => d in table).map((d) => [d, table[d]]));
};

const req = (over: Partial<PoolPageRequest> = {}): PoolPageRequest => ({ now: 1_700_000_000, poolsFetcher, pricesFetcher, ...over });

afterEach(() => {
  _clearCosmosRegistryCache();
});

// Warm the chain-registry cache with the stub so the adapter's cosmosAssetMap("osmosis") is a hit.
const seedRegistry = () => cosmosAssetMap("osmosis", { force: true, fetcher: async () => REGISTRY });

describe("sqsAdapter.poolPage", () => {
  it("discovers 2-asset chain-registry-identified pools, deduped to the deepest per pair", async () => {
    await seedRegistry();
    const page = await sqsAdapter.poolPage("osmosis", "osmosis_sqs", 1, req());

    expect(page.poolCount).toBe(3); // pools 1,2,3 are candidates; 4 (multi), 5 (unlisted), 6 (no id) excluded
    expect(page.pools).toHaveLength(2); // deduped: deepest OSMO/USDC (pool 1) + ATOM/OSMO (pool 3)
    expect(page.pools.map((p) => p.poolId).sort()).toEqual(["1", "3"]);
  });

  it("orients a stablecoin to the quote and reads reserve/volume/price from SQS", async () => {
    await seedRegistry();
    const page = await sqsAdapter.poolPage("osmosis", "osmosis_sqs", 1, req());
    const osmoUsdc = page.pools.find((p) => p.poolId === "1");

    expect(osmoUsdc?.baseAddress).toBe(OSMO); // USDC was listed first but is flipped to the quote
    expect(osmoUsdc?.quoteAddress).toBe(USDC);
    expect(osmoUsdc?.reserveUsd).toBe(1_000_000);
    expect(osmoUsdc?.volume24hUsd).toBe(50000);
    expect(osmoUsdc?.baseTokenPriceUsd).toBe(0.047);
    expect(osmoUsdc?.quoteTokenPriceUsd).toBe(1);
    expect(osmoUsdc?.dexId).toBe("osmosis_sqs");
  });

  it("keeps the pool's own order when neither side is a stablecoin", async () => {
    await seedRegistry();
    const page = await sqsAdapter.poolPage("osmosis", "osmosis_sqs", 1, req());
    const atomOsmo = page.pools.find((p) => p.poolId === "3");
    expect(atomOsmo?.baseAddress).toBe(ATOM);
    expect(atomOsmo?.quoteAddress).toBe(OSMO);
  });

  it("normalises each token's identity from the chain-registry", async () => {
    await seedRegistry();
    const page = await sqsAdapter.poolPage("osmosis", "osmosis_sqs", 1, req());
    expect(page.tokens.get(OSMO)).toMatchObject({ address: OSMO, symbol: "OSMO", decimals: 6, coingeckoCoinId: "osmosis", priceUsd: 0.047 });
    expect(page.tokens.get(USDC)).toMatchObject({ symbol: "USDC", coingeckoCoinId: "usd-coin" });
  });

  it("returns an empty page beyond page 1 (SQS returns the whole set at once)", async () => {
    await seedRegistry();
    const page = await sqsAdapter.poolPage("osmosis", "osmosis_sqs", 2, req());
    expect(page.poolCount).toBe(0);
    expect(page.pools).toHaveLength(0);
  });

  it("returns an empty page for a chain with no SQS quote denom configured", async () => {
    const page = await sqsAdapter.poolPage("not-cosmos", "x", 1, req());
    expect(page.poolCount).toBe(0);
  });
});

describe("sqsAdapter.corroborate", () => {
  it("makes no claim — Cosmos has no pricing subgraph (fail-open)", async () => {
    const facts = await sqsAdapter.corroborate("osmosis", "osmosis_sqs", []);
    expect(facts.idsAlign).toBe(false);
    expect(facts.present.size).toBe(0);
    expect(facts.hooks.size).toBe(0);
  });
});
