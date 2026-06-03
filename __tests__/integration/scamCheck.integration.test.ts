// Integration tests for runScamCheckForToken (A.7). GoPlus HTTP is stubbed via
// the injectable fetcher; asserts the token metadata is stored, the flag is
// derived, and AutoVerified pairs are demoted (Manual* untouched, R6).

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, seedPair, seedToken, testPrisma } from "./helpers";
import { runScamCheckForToken, tokensToScamCheck } from "../../lib/scamCheck";
import { TokenPairStatus } from "../../types/types";

const NOW = 1_700_000_000;
const honeypotFetcher = async () => ({ is_honeypot: "1", sell_tax: "0.99" });
const cleanFetcher = async () => ({ is_honeypot: "0", buy_tax: "0", sell_tax: "0" });

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("runScamCheckForToken", () => {
  it("stores GoPlus data on the token, flags it, and demotes AutoVerified pairs", async () => {
    const t0 = await seedToken({ symbol: "SCAM", coingeckoCoinId: "scam-coin" });
    const t1 = await seedToken({ symbol: "WETH", coingeckoCoinId: "weth" });
    const autoPair = await seedPair(t0.id, t1.id, { status: TokenPairStatus.AutoVerified });
    const manualPair = await seedPair(t0.id, t1.id, { status: TokenPairStatus.ManualVerified });

    const out = await runScamCheckForToken(t0.id, { now: NOW, fetcher: honeypotFetcher });

    expect(out.flagged).toBe(true);
    expect(out.reasons).toContain("honeypot");
    expect(out.demotedPairs).toBe(1);

    const token = await testPrisma.token.findUnique({ where: { id: t0.id } });
    expect(token?.isScamFlagged).toBe(true);
    expect(token?.scamReason).toMatch(/honeypot/);
    expect(token?.scamCheckedAt).toBe(NOW);
    expect(token?.goPlusData).toBeTruthy(); // raw response stored

    // AutoVerified demoted to NeedsReview + triaged as spam; ManualVerified left
    // alone (R6).
    const demoted = await testPrisma.pair.findUnique({ where: { id: autoPair.id } });
    expect(demoted?.status).toBe(TokenPairStatus.NeedsReview);
    expect(demoted?.reviewTier).toBe("spam"); // scam flag → likely spam (T9), no revalidate needed
    expect((await testPrisma.pair.findUnique({ where: { id: manualPair.id } }))?.status).toBe(TokenPairStatus.ManualVerified);
  });

  it("stores a clean result without flagging or demoting", async () => {
    const t0 = await seedToken({ coingeckoCoinId: "clean" });
    const t1 = await seedToken({ coingeckoCoinId: "weth" });
    const pair = await seedPair(t0.id, t1.id, { status: TokenPairStatus.AutoVerified });

    const out = await runScamCheckForToken(t0.id, { now: NOW, fetcher: cleanFetcher });

    expect(out.flagged).toBe(false);
    expect(out.demotedPairs).toBe(0);
    const token = await testPrisma.token.findUnique({ where: { id: t0.id } });
    expect(token?.isScamFlagged).toBe(false);
    expect((await testPrisma.pair.findUnique({ where: { id: pair.id } }))?.status).toBe(TokenPairStatus.AutoVerified);
  });

  it("skips a chain GoPlus doesn't index (no write)", async () => {
    const t0 = await seedToken({ chain: "qom", coingeckoCoinId: "qom-coin" });
    const out = await runScamCheckForToken(t0.id, { now: NOW, fetcher: honeypotFetcher });
    expect(out.checked).toBe(false);
    const token = await testPrisma.token.findUnique({ where: { id: t0.id } });
    expect(token?.isScamFlagged).toBe(false);
  });
});

describe("tokensToScamCheck", () => {
  it("returns verified-pair tokens not yet checked this job", async () => {
    const t0 = await seedToken({ coingeckoCoinId: "weth" });
    const t1 = await seedToken({ coingeckoCoinId: "usd-coin", decimals: 6 });
    await seedPair(t0.id, t1.id, { status: TokenPairStatus.AutoVerified });

    const ids = await tokensToScamCheck(NOW, 50);
    expect(ids.sort()).toEqual([t0.id, t1.id].sort());
  });

  it("excludes tokens whose pairs are not verified", async () => {
    const t0 = await seedToken({ coingeckoCoinId: "weth" });
    const t1 = await seedToken({ coingeckoCoinId: "usd-coin", decimals: 6 });
    await seedPair(t0.id, t1.id, { status: TokenPairStatus.Unverified });

    expect(await tokensToScamCheck(NOW, 50)).toEqual([]);
  });

  it("excludes tokens already checked this job and unsupported chains", async () => {
    const checked = await seedToken({ coingeckoCoinId: "weth", scamCheckedAt: NOW });
    const fresh = await seedToken({ coingeckoCoinId: "usd-coin", decimals: 6 });
    await seedPair(checked.id, fresh.id, { status: TokenPairStatus.AutoVerified });

    const q1 = await seedToken({ chain: "qom", coingeckoCoinId: "qom-a" });
    const q2 = await seedToken({ chain: "qom", coingeckoCoinId: "qom-b" });
    await seedPair(q1.id, q2.id, { chain: "qom", dex: "qomswap_v2", status: TokenPairStatus.AutoVerified });

    // `checked` excluded (scamCheckedAt == jobStartedAt, not <); qom tokens
    // excluded (unsupported chain). Only the fresh eth token remains.
    expect(await tokensToScamCheck(NOW, 50)).toEqual([fresh.id]);
  });
});
