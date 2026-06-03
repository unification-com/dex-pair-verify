// Integration tests for lib/verdictRunner.ts — the DB-backed verdict bridge.
// Seeds tokens/pairs + a fresh CanonicalAddress cache (so fetchCanonicalContract
// resolves from cache, never the network) and asserts the persisted verdict.

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, seedPair, seedToken, testPrisma } from "./helpers";
import { runVerdictForPair } from "../../lib/verdictRunner";
import { TokenPairStatus, VerificationMethod } from "../../types/types";

const NOW = 1_700_000_000;

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const FAKE_WETH = "0x000000000000000000000000000000000000dEaD";

async function seedCanonical(coingeckoCoinId: string, chain: string, contractAddress: string) {
  return testPrisma.canonicalAddress.create({
    data: { coingeckoCoinId, chain, contractAddress, lastChecked: NOW },
  });
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("runVerdictForPair", () => {
  it("auto-verifies a clean pair and persists the verdict", async () => {
    const t0 = await seedToken({ contractAddress: WETH, coingeckoCoinId: "weth", decimals: 18 });
    const t1 = await seedToken({ contractAddress: USDC, coingeckoCoinId: "usd-coin", decimals: 6 });
    await seedCanonical("weth", "eth", WETH);
    await seedCanonical("usd-coin", "eth", USDC);
    const pair = await seedPair(t0.id, t1.id);

    const out = await runVerdictForPair(pair.id, { now: NOW });

    expect(out.found).toBe(true);
    expect(out.persisted).toBe(true);
    expect(out.result?.verdict).toBe(TokenPairStatus.AutoVerified);
    expect(out.result?.confidence).toBe(1);

    const row = await testPrisma.pair.findUnique({ where: { id: pair.id } });
    expect(row?.status).toBe(TokenPairStatus.AutoVerified);
    expect(row?.canonicalKey).toBe("usd-coin:weth");
    expect(row?.verificationMethod).toBe(VerificationMethod.Auto);
    expect(row?.verdictAt).toBe(NOW);
    expect(row?.confidence).toBe(1);
  });

  it("never overrides an operator (Manual*) status — rule R6", async () => {
    const t0 = await seedToken({ contractAddress: WETH, coingeckoCoinId: "weth" });
    const t1 = await seedToken({ contractAddress: USDC, coingeckoCoinId: "usd-coin", decimals: 6 });
    const pair = await seedPair(t0.id, t1.id, {
      status: TokenPairStatus.ManualVerified,
      verificationMethod: VerificationMethod.Manual,
    });

    const out = await runVerdictForPair(pair.id, { now: NOW });

    expect(out.skippedManual).toBe(true);
    expect(out.persisted).toBe(false);
    const row = await testPrisma.pair.findUnique({ where: { id: pair.id } });
    expect(row?.status).toBe(TokenPairStatus.ManualVerified);
  });

  it("auto-verifies via a verified cross-source sibling despite a price wobble", async () => {
    const t0 = await seedToken({ contractAddress: WETH, coingeckoCoinId: "weth" });
    const t1 = await seedToken({ contractAddress: USDC, coingeckoCoinId: "usd-coin", decimals: 6 });
    await seedCanonical("weth", "eth", WETH);
    await seedCanonical("usd-coin", "eth", USDC);

    // A verified sibling on a different (chain, dex) sharing the canonical key.
    const s0 = await seedToken({ coingeckoCoinId: "weth", chain: "polygon_pos" });
    const s1 = await seedToken({ coingeckoCoinId: "usd-coin", chain: "polygon_pos", decimals: 6 });
    await seedPair(s0.id, s1.id, {
      chain: "polygon_pos",
      dex: "quickswap_v3",
      canonicalKey: "usd-coin:weth",
      status: TokenPairStatus.ManualVerified,
      verificationMethod: VerificationMethod.Manual,
    });

    // Target pair: 20% price deviation would normally land it in NeedsReview…
    const pair = await seedPair(t0.id, t1.id, { token0PriceDex: 2400 });
    const out = await runVerdictForPair(pair.id, { now: NOW });

    expect(out.result?.verdict).toBe(TokenPairStatus.AutoVerified);
    expect(out.result?.reason).toMatch(/sibling/i);
  });

  it("marks the loser of an intra-chain impostor conflict NotCurrentlyUsable", async () => {
    await seedCanonical("weth", "eth", WETH);
    await seedCanonical("usd-coin", "eth", USDC);
    const shared1 = await seedToken({ contractAddress: USDC, coingeckoCoinId: "usd-coin", decimals: 6 });

    // The real pair: token0 matches the canonical WETH address. Its key is
    // already persisted (it would have been verdicted first).
    const real0 = await seedToken({ contractAddress: WETH, coingeckoCoinId: "weth" });
    await seedPair(real0.id, shared1.id, { canonicalKey: "usd-coin:weth", status: TokenPairStatus.AutoVerified });

    // The impostor pair: same coins, same (chain, dex), but a fake token0
    // address — does NOT match the canonical WETH.
    const fake0 = await seedToken({ contractAddress: FAKE_WETH, coingeckoCoinId: "weth" });
    const impostor = await seedPair(fake0.id, shared1.id);

    const out = await runVerdictForPair(impostor.id, { now: NOW });

    expect(out.result?.verdict).toBe(TokenPairStatus.NotCurrentlyUsable);
  });

  it("computes but does not write when persist is disabled", async () => {
    const t0 = await seedToken({ contractAddress: WETH, coingeckoCoinId: "weth" });
    const t1 = await seedToken({ contractAddress: USDC, coingeckoCoinId: "usd-coin", decimals: 6 });
    await seedCanonical("weth", "eth", WETH);
    await seedCanonical("usd-coin", "eth", USDC);
    const pair = await seedPair(t0.id, t1.id);

    const out = await runVerdictForPair(pair.id, { now: NOW, persist: false });

    expect(out.result?.verdict).toBe(TokenPairStatus.AutoVerified);
    expect(out.persisted).toBe(false);
    const row = await testPrisma.pair.findUnique({ where: { id: pair.id } });
    expect(row?.status).toBe(TokenPairStatus.Unverified); // untouched
    expect(row?.canonicalKey).toBeNull();
  });

  it("returns found=false for an unknown pair id", async () => {
    const out = await runVerdictForPair("does-not-exist", { now: NOW });
    expect(out.found).toBe(false);
    expect(out.result).toBeNull();
  });

  it("honours a per-(chain,dex) Threshold row (A.3) — high min liquidity holds an otherwise-clean pair for review", async () => {
    const t0 = await seedToken({ contractAddress: WETH, coingeckoCoinId: "weth" });
    const t1 = await seedToken({ contractAddress: USDC, coingeckoCoinId: "usd-coin", decimals: 6 });
    await seedCanonical("weth", "eth", WETH);
    await seedCanonical("usd-coin", "eth", USDC);
    // Reserve is 1,000,000 (seedPair default); set the floor above it.
    await testPrisma.threshold.create({
      data: { chain: "eth", dex: "uniswap_v3", minLiquidityUsd: 5_000_000, minTxCount: 0 },
    });
    const pair = await seedPair(t0.id, t1.id);

    const out = await runVerdictForPair(pair.id, { now: NOW });

    // Without the threshold it would auto-verify; the liquidity gate now fails.
    expect(out.result?.verdict).toBe(TokenPairStatus.NeedsReview);
  });
});
