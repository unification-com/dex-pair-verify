// Integration tests for lib/export.ts — the shared v2 export builder. Asserts
// only verified pairs are emitted (the A.6/R5 contract) and the manifest groups
// correctly.

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, seedPair, seedToken, testPrisma } from "./helpers";
import { buildExportIndex, buildExportV2, EXPORT_SCHEMA_VERSION, exportLastModified } from "../../lib/export";
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

    expect(out.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(out.generatedAt).toBe(NOW);
    expect(out.chain).toBe("eth");
    expect(out.pairs).toHaveLength(1);
    const p = out.pairs[0];
    expect(p.pair).toBe("WETH-USDC");
    expect(p.verdict).toBe(TokenPairStatus.AutoVerified);
    expect(p.verdictReason).toMatch(/fences/i);
    expect(p.token0?.symbol).toBe("WETH");
    expect(p.token1?.symbol).toBe("USDC");
  });

  it("includes ManualVerified pairs too (both count as verified)", async () => {
    await seedVerifiedPair({ status: TokenPairStatus.ManualVerified, verificationMethod: VerificationMethod.Manual });
    const out = await buildExportV2("eth", "uniswap_v3", { now: NOW });
    expect(out.pairs).toHaveLength(1);
    expect(out.pairs[0].verdict).toBe(TokenPairStatus.ManualVerified);
  });

  it("orders pairs by reserveUsd descending", async () => {
    await seedVerifiedPair({ pair: "A", reserveUsd: 100 });
    await seedVerifiedPair({ pair: "B", reserveUsd: 9_000_000 });
    const out = await buildExportV2("eth", "uniswap_v3", { now: NOW });
    expect(out.pairs.map((p) => p.pair)).toEqual(["B", "A"]);
  });
});

describe("buildExportIndex", () => {
  it("groups verified pair counts by chain and dex", async () => {
    await seedVerifiedPair({ lastChecked: 1000 });
    await seedVerifiedPair({ lastChecked: 2000 });
    await seedVerifiedPair({ dex: "sushiswap" });

    const idx = await buildExportIndex({ now: NOW });

    expect(idx.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    const eth = idx.chains.find((c) => c.chain === "eth");
    const uni = eth?.dexs.find((d) => d.dex === "uniswap_v3");
    expect(uni?.pairCount).toBe(2);
    expect(uni?.lastUpdated).toBe(2000);
    expect(uni?.url).toBe("/api/export/eth/uniswap_v3");
    expect(eth?.dexs.find((d) => d.dex === "sushiswap")?.pairCount).toBe(1);
  });
});

describe("exportLastModified", () => {
  it("returns the max lastChecked across verified pairs", async () => {
    await seedVerifiedPair({ lastChecked: 1500 });
    await seedVerifiedPair({ lastChecked: 4200 });
    expect(await exportLastModified("eth", "uniswap_v3")).toBe(4200);
  });

  it("returns 0 when there are no verified pairs", async () => {
    expect(await exportLastModified("eth", "uniswap_v3")).toBe(0);
  });
});
