// Integration tests for lib/export.ts — the shared v2 export builder. Asserts
// only verified pairs are emitted (the A.6/R5 contract) and the manifest groups
// correctly.

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, seedPair, seedToken, testPrisma } from "./helpers";
import {
  buildExportManifestV3,
  buildExportV2,
  EXPORT_MANIFEST_SCHEMA_VERSION,
  EXPORT_PAIR_SCHEMA_VERSION,
  exportLastModified,
} from "../../lib/export";
import { TokenPairStatus, VerificationMethod } from "../../types/types";

const NOW = 1_700_000_000;

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

async function seedVerifiedPair(over = {}) {
  const t0 = await seedToken({ symbol: "WETH", coingeckoCoinId: "weth" });
  const t1 = await seedToken({ symbol: "USDC", coingeckoCoinId: "usd-coin", decimals: 6 });
  return seedPair(t0.id, t1.id, {
    status: TokenPairStatus.AutoVerified,
    verificationMethod: VerificationMethod.Auto,
    verificationComment: "all fences passed with high confidence",
    lastChecked: NOW,
    ...over,
  });
}

describe("buildExportV2", () => {
  it("emits the v2 shape with verdict + reason for verified pairs only", async () => {
    await seedVerifiedPair({ pair: "WETH-USDC", reserveUsd: 5_000_000 });
    // An unverified + a rejected pair must NOT appear in the export.
    const u0 = await seedToken({ coingeckoCoinId: "weth" });
    const u1 = await seedToken({ coingeckoCoinId: "usd-coin", decimals: 6 });
    await seedPair(u0.id, u1.id, { status: TokenPairStatus.Unverified });
    await seedPair(u0.id, u1.id, { status: TokenPairStatus.AutoRejected });

    const out = await buildExportV2("eth", "uniswap_v3", { now: NOW });

    expect(out.schemaVersion).toBe(EXPORT_PAIR_SCHEMA_VERSION);
    expect(out.schemaVersion).toBe(3);
    expect(out.generatedAt).toBe(NOW);
    expect(out.chain).toBe("eth");
    expect(out.minLiquidityUsd).toBe(0); // no Threshold row seeded → default floor
    expect(out.pairs).toHaveLength(1);
    const p = out.pairs[0];
    expect(p.pair).toBe("WETH-USDC");
    expect(p.verdict).toBe(TokenPairStatus.AutoVerified);
    expect(p.verdictReason).toMatch(/fences/i);
    expect(p.token0?.symbol).toBe("WETH");
    expect(p.token1?.symbol).toBe("USDC");
  });

  it("exports the engine confidence as the trust score for an AutoVerified pair", async () => {
    await seedVerifiedPair({ confidence: 0.91234 });
    const out = await buildExportV2("eth", "uniswap_v3", { now: NOW });
    expect(out.pairs[0].confidence).toBe(0.9123); // rounded to 4dp
  });

  it("exports trust score 1 for a ManualVerified pair regardless of confidence", async () => {
    await seedVerifiedPair({
      status: TokenPairStatus.ManualVerified,
      verificationMethod: VerificationMethod.Manual,
      confidence: null,
    });
    const out = await buildExportV2("eth", "uniswap_v3", { now: NOW });
    expect(out.pairs).toHaveLength(1);
    expect(out.pairs[0].verdict).toBe(TokenPairStatus.ManualVerified);
    expect(out.pairs[0].confidence).toBe(1);
  });

  it("includes the per-(chain,dex) curation floor from the Threshold row", async () => {
    await testPrisma.threshold.create({ data: { chain: "eth", dex: "uniswap_v3", minLiquidityUsd: 30000, minTxCount: 0 } });
    await seedVerifiedPair();
    const out = await buildExportV2("eth", "uniswap_v3", { now: NOW });
    expect(out.minLiquidityUsd).toBe(30000);
  });

  it("orders pairs by reserveUsd descending", async () => {
    await seedVerifiedPair({ pair: "A", reserveUsd: 100 });
    await seedVerifiedPair({ pair: "B", reserveUsd: 9_000_000 });
    const out = await buildExportV2("eth", "uniswap_v3", { now: NOW });
    expect(out.pairs.map((p) => p.pair)).toEqual(["B", "A"]);
  });
});

const seedSource = (chain: string, dex: string, over: Record<string, unknown> = {}) =>
  testPrisma.supportedSource.create({
    data: {
      chain,
      dex,
      subgraphUrlTemplate: `https://gateway.thegraph.com/api/{API_KEY}/subgraphs/id/${dex}`,
      subgraphSchemaFamily: "univ3",
      subgraphProvider: "graph-decentralized",
      factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
      lastVerifiedAt: 1234,
      enabledAt: 1000,
      ...over,
    },
  });

describe("buildExportManifestV3", () => {
  it("emits the SupportedSource registry with endpoints, schema family + verified pair counts", async () => {
    await seedSource("eth", "uniswap_v3");
    await seedSource("eth", "sushiswap", { subgraphSchemaFamily: "univ2" });
    await seedVerifiedPair({ lastChecked: 1000 });
    await seedVerifiedPair({ lastChecked: 2000 });
    await seedVerifiedPair({ dex: "sushiswap" });

    const m = await buildExportManifestV3({ now: NOW });

    expect(m.schemaVersion).toBe(EXPORT_MANIFEST_SCHEMA_VERSION);
    expect(m.schemaVersion).toBe(3);
    const uni = m.supportedSources.find((s) => s.chain === "eth" && s.dex === "uniswap_v3");
    expect(uni?.pairCount).toBe(2);
    expect(uni?.lastUpdated).toBe(2000);
    expect(uni?.exportUrl).toBe("/api/ooo/v1/export/eth/uniswap_v3");
    expect(uni?.subgraphSchemaFamily).toBe("univ3");
    expect(uni?.rpcUrl).toBe("https://ethereum-rpc.publicnode.com"); // from chainInfo
    expect(uni?.lastVerifiedAt).toBe(1234);
    expect(uni?.endpoints).toEqual([
      { provider: "graph-decentralized", urlTemplate: "https://gateway.thegraph.com/api/{API_KEY}/subgraphs/id/uniswap_v3", tier: "paid" },
    ]);
    expect(m.supportedSources.find((s) => s.dex === "sushiswap")?.pairCount).toBe(1);
  });

  it("appends free-tier additional endpoints, tier derived from provider", async () => {
    await seedSource("eth", "uniswap_v3", {
      additionalEndpoints: [{ provider: "graph-studio", urlTemplate: "https://api.studio.thegraph.com/query/1/x/v1" }],
    });

    const m = await buildExportManifestV3({ now: NOW });
    const uni = m.supportedSources.find((s) => s.dex === "uniswap_v3");
    expect(uni?.endpoints).toHaveLength(2);
    expect(uni?.endpoints[0].tier).toBe("paid");
    expect(uni?.endpoints[1]).toEqual({
      provider: "graph-studio",
      urlTemplate: "https://api.studio.thegraph.com/query/1/x/v1",
      tier: "free",
    });
  });
});

describe("exportLastModified", () => {
  it("returns the latest lastChecked / verdictAt across the (chain,dex)'s pairs", async () => {
    await seedVerifiedPair({ lastChecked: 1500 });
    await seedVerifiedPair({ lastChecked: 4200 });
    expect(await exportLastModified("eth", "uniswap_v3")).toBe(4200);
  });

  it("advances when a pair is DEMOTED out of the verified set, not just on ingest", async () => {
    // A still-verified pair (old lastChecked) plus a pair just demoted to
    // NeedsReview with a fresh verdictAt. The verified export's contents changed,
    // so the modified-time must move — even though the demoted pair is no longer
    // verified. Regression: a verified-only max(lastChecked) returned 1000 here
    // and go-ooo would 304 past the demotion, still trusting the delisted pair.
    await seedVerifiedPair({ lastChecked: 1000 });
    const t0 = await seedToken({ symbol: "SCAM" });
    const t1 = await seedToken({ symbol: "USDC", coingeckoCoinId: "usd-coin", decimals: 6 });
    await seedPair(t0.id, t1.id, { status: TokenPairStatus.NeedsReview, lastChecked: 1000, verdictAt: 5000 });
    expect(await exportLastModified("eth", "uniswap_v3")).toBe(5000);
  });

  it("returns 0 when there are no pairs", async () => {
    expect(await exportLastModified("eth", "uniswap_v3")).toBe(0);
  });
});
