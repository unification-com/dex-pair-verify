// Integration tests for runCanonicalCheckForToken + tokensToCanonicalCheck +
// getCachedCanonicalAddress (T3). The CoinGecko platforms fetch is injected;
// asserts the canonical is cached and the impostor fence then runs globally —
// a matching address auto-verifies, a mismatch routes to Needs Review.

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, seedPair, seedToken, testPrisma } from "./helpers";
import { getCachedCanonicalAddress } from "../../lib/canonical";
import { runCanonicalCheckForToken, tokensToCanonicalCheck } from "../../lib/canonicalCheck";
import { TokenPairStatus } from "../../types/types";

const NOW = 1_700_000_000;
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const FAKE = "0x000000000000000000000000000000000000BEEF";

// Injected CoinGecko platforms fetch: maps the coin id to its canonical address.
const platforms = async (cgId: string) =>
  cgId === "weth" ? { ethereum: WETH } : { ethereum: USDC };

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("runCanonicalCheckForToken", () => {
  it("caches the canonical address and a matching pair auto-verifies", async () => {
    const t0 = await seedToken({ coingeckoCoinId: "weth", contractAddress: WETH });
    const t1 = await seedToken({ coingeckoCoinId: "usd-coin", contractAddress: USDC, decimals: 6 });
    const pair = await seedPair(t0.id, t1.id, { status: TokenPairStatus.NeedsReview });

    const out = await runCanonicalCheckForToken(t0.id, { now: NOW, fetcher: platforms });

    expect(out.hasAddress).toBe(true);
    expect(out.impostorPairs).toBe(0);
    expect(await getCachedCanonicalAddress("weth", "eth")).toBe(WETH);
    expect((await testPrisma.token.findUnique({ where: { id: t0.id } }))?.canonicalCheckedAt).toBe(NOW);
    expect((await testPrisma.pair.findUnique({ where: { id: pair.id } }))?.status).toBe(TokenPairStatus.AutoVerified);
  });

  it("routes a pair to Needs Review when a token address mismatches the canonical", async () => {
    const t0 = await seedToken({ coingeckoCoinId: "weth", contractAddress: FAKE }); // impostor WETH
    const t1 = await seedToken({ coingeckoCoinId: "usd-coin", contractAddress: USDC, decimals: 6 });
    const pair = await seedPair(t0.id, t1.id, { status: TokenPairStatus.AutoVerified });

    const out = await runCanonicalCheckForToken(t0.id, { now: NOW, fetcher: platforms });

    expect(out.impostorPairs).toBe(1);
    expect((await testPrisma.pair.findUnique({ where: { id: pair.id } }))?.status).toBe(TokenPairStatus.NeedsReview);
  });

  it("stamps the attempt on a transient failure so the batch terminates", async () => {
    const t0 = await seedToken({ coingeckoCoinId: "weth", contractAddress: WETH });
    const t1 = await seedToken({ coingeckoCoinId: "usd-coin", contractAddress: USDC, decimals: 6 });
    await seedPair(t0.id, t1.id, { status: TokenPairStatus.NeedsReview });

    const out = await runCanonicalCheckForToken(t0.id, { now: NOW, fetcher: async () => null });
    expect(out.checked).toBe(false);
    // Stamped so it drops out of the to-check set; no canonical was cached.
    expect((await testPrisma.token.findUnique({ where: { id: t0.id } }))?.canonicalCheckedAt).toBe(NOW);
    expect(await getCachedCanonicalAddress("weth", "eth")).toBeNull();
  });

  it("never overrides a Manual* pair (R6)", async () => {
    const t0 = await seedToken({ coingeckoCoinId: "weth", contractAddress: FAKE });
    const t1 = await seedToken({ coingeckoCoinId: "usd-coin", contractAddress: USDC, decimals: 6 });
    const pair = await seedPair(t0.id, t1.id, { status: TokenPairStatus.ManualVerified });
    await runCanonicalCheckForToken(t0.id, { now: NOW, fetcher: platforms });
    expect((await testPrisma.pair.findUnique({ where: { id: pair.id } }))?.status).toBe(TokenPairStatus.ManualVerified);
  });
});

describe("tokensToCanonicalCheck", () => {
  it("selects cgId-bearing EVM pair tokens not yet checked", async () => {
    const t0 = await seedToken({ coingeckoCoinId: "weth" });
    const t1 = await seedToken({ coingeckoCoinId: "usd-coin", decimals: 6 });
    await seedPair(t0.id, t1.id);

    const noCg = await seedToken({ coingeckoCoinId: "" }); // no cgId → excluded
    const checked = await seedToken({ coingeckoCoinId: "dai", canonicalCheckedAt: NOW }); // done → excluded
    await seedPair(noCg.id, checked.id);

    const q0 = await seedToken({ chain: "qom", coingeckoCoinId: "q0" });
    const q1 = await seedToken({ chain: "qom", coingeckoCoinId: "q1" });
    await seedPair(q0.id, q1.id, { chain: "qom", dex: "qomswap_v2" });

    const ids = await tokensToCanonicalCheck(NOW, 50);
    expect(ids.sort()).toEqual([t0.id, t1.id].sort());
  });
});
