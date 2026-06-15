// Integration test for the Cosmos (Osmosis SQS) ingest path (#128 Phase 2c) — proves an Osmosis pair
// discovered from a stubbed SQS pool set LANDS in the DB, is verdicted (chain-registry identity →
// AutoVerified; sub-floor → AutoRejected), and reaches the export manifest + feed marked as a rest-sqs
// source — all with no GeckoTerminal / EVM involvement. The chain-registry is stubbed via its memoised
// cache; the SQS pools + prices transports are injected.

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, testPrisma } from "./helpers";
import { cosmosAssetMap, _clearCosmosRegistryCache } from "../../lib/cosmosRegistry";
import { buildExportManifestV3, buildExportV2 } from "../../lib/export";
import { ingestPoolPage } from "../../lib/ingest";
import { invalidateSourceCache } from "../../lib/sourceConfig";
import { SqsPool, SqsPoolsFetcher, SqsPricesFetcher } from "../../lib/sqs";
import { TokenPairStatus, VerificationMethod } from "../../types/types";

const NOW = 1_700_000_000;
const OSMO = "uosmo";
const ATOM = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";
const USDC = "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4";
const TIA = "ibc/D79E7D83AB399BFFF93433E54FAA480C191248FC556924A2A8351AE2638B3877";

const REGISTRY = {
  assets: [
    { base: OSMO, symbol: "OSMO", name: "Osmosis", display: "osmo", coingecko_id: "osmosis", denom_units: [{ denom: OSMO, exponent: 0 }, { denom: "osmo", exponent: 6 }] },
    { base: ATOM, symbol: "ATOM", name: "Cosmos Hub Atom", display: "atom", coingecko_id: "cosmos", denom_units: [{ denom: ATOM, exponent: 0 }, { denom: "atom", exponent: 6 }] },
    { base: USDC, symbol: "USDC", name: "USDC", display: "usdc", coingecko_id: "usd-coin", denom_units: [{ denom: USDC, exponent: 0 }, { denom: "usdc", exponent: 6 }] },
    { base: TIA, symbol: "TIA", name: "Celestia", display: "tia", coingecko_id: "celestia", denom_units: [{ denom: TIA, exponent: 0 }, { denom: "tia", exponent: 6 }] },
  ],
};

const b = (denom: string) => ({ denom, amount: "1" });
const POOLS: SqsPool[] = [
  { type: 1, liquidity_cap: "1000000", fees_data: { volume_24h: 50000 }, balances: [b(USDC), b(OSMO)], chain_model: { pool_id: 1 } },
  { type: 0, liquidity_cap: "800000", fees_data: { volume_24h: 30000 }, balances: [b(ATOM), b(OSMO)], chain_model: { pool_id: 2 } },
  // Below the hard floor → AutoRejected (proves the verdict's floor is live, not a pass-through).
  { type: 1, liquidity_cap: "100", fees_data: { volume_24h: 1 }, balances: [b(TIA), b(USDC)], chain_model: { pool_id: 3 } },
  // Multi-asset transmuter → skipped at discovery (breaks the pair abstraction).
  { type: 3, liquidity_cap: "9000000", balances: [b(OSMO), b(ATOM), b(USDC)], chain_model: { pool_id: 4 } },
];

const poolsFetcher: SqsPoolsFetcher = async () => POOLS;
const pricesFetcher: SqsPricesFetcher = async (_url, denoms) => {
  const table: Record<string, number> = { [OSMO]: 0.047, [USDC]: 1, [ATOM]: 1.99, [TIA]: 5.5 };
  return new Map(denoms.filter((d) => d in table).map((d) => [d, table[d]]));
};

beforeEach(async () => {
  await resetDb();
  _clearCosmosRegistryCache();
  invalidateSourceCache();
  await cosmosAssetMap("osmosis", { force: true, fetcher: async () => REGISTRY });
  await testPrisma.supportedSource.create({
    data: {
      chain: "osmosis",
      dex: "osmosis_sqs",
      sourceType: "rest-sqs",
      subgraphUrlTemplate: "https://sqs.osmosis.zone",
      subgraphSchemaFamily: "custom",
      subgraphProvider: "self-hosted",
      factoryAddress: "",
      onCoinGeckoTerminal: false,
      lastPage: 1,
    },
  });
  invalidateSourceCache();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("Osmosis SQS ingest → verdict → export", () => {
  it("lands + auto-verifies chain-registry-identified pools, rejecting a sub-floor one", async () => {
    const res = await ingestPoolPage("osmosis", "osmosis_sqs", 1, { now: NOW, poolsFetcher, pricesFetcher });
    expect(res.pairs).toBe(3); // OSMO/USDC, ATOM/OSMO, TIA/USDC ingested; the multi-asset pool is skipped

    const osmoUsdc = await testPrisma.pair.findFirst({ where: { chain: "osmosis", contractAddress: "1" }, include: { token0: true } });
    expect(osmoUsdc?.pair).toBe("OSMO-USDC"); // the stablecoin is oriented to the quote
    expect(osmoUsdc?.status).toBe(TokenPairStatus.AutoVerified);
    expect(osmoUsdc?.verificationMethod).toBe(VerificationMethod.Auto);
    expect(osmoUsdc?.reserveUsd).toBe(1_000_000);
    expect(osmoUsdc?.canonicalKey).toBeTruthy();
    expect(osmoUsdc?.token0.contractAddress).toBe(OSMO);
    expect(osmoUsdc?.token0.coingeckoCoinId).toBe("osmosis");

    const tiaUsdc = await testPrisma.pair.findFirst({ where: { chain: "osmosis", contractAddress: "3" } });
    expect(tiaUsdc?.status).toBe(TokenPairStatus.AutoRejected); // below the hard liquidity floor

    // Token rows carry chain-registry identity — no GeckoTerminal lookup was made.
    const atom = await testPrisma.token.findFirst({ where: { contractAddress: ATOM } });
    expect(atom?.symbol).toBe("ATOM");
    expect(atom?.coingeckoCoinId).toBe("cosmos");
    expect(atom?.decimals).toBe(6);
  });

  it("exports the Osmosis source as rest-sqs with its verified pairs", async () => {
    await ingestPoolPage("osmosis", "osmosis_sqs", 1, { now: NOW, poolsFetcher, pricesFetcher });

    const manifest = await buildExportManifestV3({ now: NOW });
    const osmo = manifest.supportedSources.find((s) => s.chain === "osmosis" && s.dex === "osmosis_sqs");
    expect(osmo?.sourceType).toBe("rest-sqs");
    expect(osmo?.endpoints[0].urlTemplate).toBe("https://sqs.osmosis.zone");
    expect(osmo?.rpcUrl).toBeNull();
    expect(osmo?.pairCount).toBe(2); // the two AutoVerified pairs (TIA/USDC was rejected)

    const feed = await buildExportV2("osmosis", "osmosis_sqs", { now: NOW });
    expect(feed.pairs.map((p) => p.pair).sort()).toEqual(["ATOM-OSMO", "OSMO-USDC"]);
    const osmoUsdc = feed.pairs.find((p) => p.pair === "OSMO-USDC");
    expect(osmoUsdc?.canonicalKey).toBeTruthy();
    expect(osmoUsdc?.confidence).toBeGreaterThan(0);
  });
});
