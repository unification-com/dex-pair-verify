// Integration tests for runScamCheckForToken (A.7). GoPlus HTTP is stubbed via
// the injectable fetcher; asserts the token metadata is stored, the flag is
// derived, and AutoVerified pairs are demoted (Manual* untouched, R6).

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, seedPair, seedToken, testPrisma } from "./helpers";
import { rescoreScamForToken, runScamCheckForToken, tokensToRescore, tokensToScamCheck } from "../../lib/scamCheck";
import { TokenPairStatus } from "../../types/types";

const NOW = 1_700_000_000;
// GoPlus stubs (the `fetcher` arg).
const goplusHoneypot = async () => ({ is_honeypot: "1", sell_tax: "0.99" });
const goplusClean = async () => ({ is_honeypot: "0", buy_tax: "0", sell_tax: "0" });
// Honeypot.is stubs (the `honeypotFetcher` arg) — default to blank so the suite
// never reaches the live honeypot.is API.
const hpBlank = async () => ({ isHoneypot: null, buyTax: null, sellTax: null, risk: null, reason: null, error: "stub" });
const hpHoneypot = async () => ({ isHoneypot: true, buyTax: null, sellTax: null, risk: "high", reason: "sell failed", error: null });

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

    const out = await runScamCheckForToken(t0.id, { now: NOW, fetcher: goplusHoneypot, honeypotFetcher: hpBlank });

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

    const out = await runScamCheckForToken(t0.id, { now: NOW, fetcher: goplusClean, honeypotFetcher: hpBlank });

    expect(out.flagged).toBe(false);
    expect(out.demotedPairs).toBe(0);
    const token = await testPrisma.token.findUnique({ where: { id: t0.id } });
    expect(token?.isScamFlagged).toBe(false);
    expect((await testPrisma.pair.findUnique({ where: { id: pair.id } }))?.status).toBe(TokenPairStatus.AutoVerified);
  });

  it("skips a chain GoPlus doesn't index (no write)", async () => {
    const t0 = await seedToken({ chain: "qom", coingeckoCoinId: "qom-coin" });
    const out = await runScamCheckForToken(t0.id, { now: NOW, fetcher: goplusHoneypot, honeypotFetcher: hpBlank });
    expect(out.checked).toBe(false);
    const token = await testPrisma.token.findUnique({ where: { id: t0.id } });
    expect(token?.isScamFlagged).toBe(false);
  });

  it("stamps the attempt when BOTH GoPlus and honeypot.is return nothing, so the batch can't loop", async () => {
    const t0 = await seedToken({ coingeckoCoinId: "weth" });
    const out = await runScamCheckForToken(t0.id, { now: NOW, fetcher: async () => null, honeypotFetcher: hpBlank });
    expect(out.checked).toBe(false);
    const token = await testPrisma.token.findUnique({ where: { id: t0.id } });
    expect(token?.scamCheckedAt).toBe(NOW); // stamped → drops out of the to-check set
    expect(token?.isScamFlagged).toBe(false); // metadata untouched
  });

  it("flags via Honeypot.is even when GoPlus is blank (the BGPT case) and demotes", async () => {
    // GoPlus never indexed this token (blank), but honeypot.is simulated a failed
    // sell — the flag must still set and demote the pair.
    const t0 = await seedToken({ symbol: "BGPT", coingeckoCoinId: "bgpt" });
    const t1 = await seedToken({ symbol: "WETH", coingeckoCoinId: "weth" });
    const pair = await seedPair(t0.id, t1.id, { status: TokenPairStatus.AutoVerified });

    const out = await runScamCheckForToken(t0.id, { now: NOW, fetcher: async () => null, honeypotFetcher: hpHoneypot });

    expect(out.checked).toBe(true);
    expect(out.flagged).toBe(true);
    expect(out.reasons.join()).toMatch(/honeypot \(simulated/);
    expect(out.demotedPairs).toBe(1);

    const token = await testPrisma.token.findUnique({ where: { id: t0.id } });
    expect(token?.isScamFlagged).toBe(true);
    expect(token?.goPlusData).toBeNull(); // GoPlus blank → not written (no clobber)
    expect(token?.honeypotData).toBeTruthy(); // honeypot result cached for rescore
    expect((await testPrisma.pair.findUnique({ where: { id: pair.id } }))?.status).toBe(TokenPairStatus.NeedsReview);
  });
});

describe("rescoreScamForToken (re-score cached GoPlus data, no re-fetch)", () => {
  it("clears a stale flag when the rule no longer flags the cached signal, and re-verifies", async () => {
    // hidden_owner alone used to flag but no longer does — the token carries the
    // stale flag + a demoted pair whose only blocker was that flag.
    const t0 = await seedToken({
      coingeckoCoinId: "rsr",
      goPlusData: { hidden_owner: "1" },
      isScamFlagged: true,
      scamReason: "hidden owner",
      scamCheckedAt: NOW,
    });
    const t1 = await seedToken({ coingeckoCoinId: "weth" });
    const pair = await seedPair(t0.id, t1.id, { status: TokenPairStatus.NeedsReview, reviewTier: "spam" });

    const out = await rescoreScamForToken(t0.id, { now: NOW });

    expect(out.changed).toBe(true);
    expect(out.flagged).toBe(false);
    expect(out.affectedPairs).toBe(1);
    expect((await testPrisma.token.findUnique({ where: { id: t0.id } }))?.isScamFlagged).toBe(false);
    expect((await testPrisma.pair.findUnique({ where: { id: pair.id } }))?.status).toBe(TokenPairStatus.AutoVerified);
  });

  it("keeps a hard flag (no change, no re-verify)", async () => {
    const t0 = await seedToken({
      coingeckoCoinId: "scam",
      goPlusData: { is_honeypot: "1" },
      isScamFlagged: true,
      scamCheckedAt: NOW,
    });
    const t1 = await seedToken({ coingeckoCoinId: "weth" });
    await seedPair(t0.id, t1.id, { status: TokenPairStatus.NeedsReview });

    const out = await rescoreScamForToken(t0.id, { now: NOW });
    expect(out.changed).toBe(false);
    expect(out.flagged).toBe(true);
    expect(out.affectedPairs).toBe(0);
  });

  it("adds a flag and demotes when the cached data now qualifies", async () => {
    // A stored honeypot signal left unflagged → re-score flags it + demotes.
    const t0 = await seedToken({
      coingeckoCoinId: "weth",
      goPlusData: { is_honeypot: "1" },
      isScamFlagged: false,
      scamCheckedAt: NOW,
    });
    const t1 = await seedToken({ coingeckoCoinId: "usd-coin", decimals: 6 });
    const pair = await seedPair(t0.id, t1.id, { status: TokenPairStatus.AutoVerified });

    const out = await rescoreScamForToken(t0.id, { now: NOW });
    expect(out.changed).toBe(true);
    expect(out.flagged).toBe(true);
    expect((await testPrisma.token.findUnique({ where: { id: t0.id } }))?.isScamFlagged).toBe(true);
    expect((await testPrisma.pair.findUnique({ where: { id: pair.id } }))?.status).toBe(TokenPairStatus.NeedsReview);
  });

  it("skips a token with neither cached GoPlus nor honeypot data", async () => {
    const t0 = await seedToken({ coingeckoCoinId: "weth", scamCheckedAt: NOW }); // both null
    const out = await rescoreScamForToken(t0.id, { now: NOW });
    expect(out.changed).toBe(false);
    expect(out.affectedPairs).toBe(0);
  });

  it("re-derives the flag from cached honeypot data when GoPlus is absent (B2)", async () => {
    const t0 = await seedToken({
      coingeckoCoinId: "bgpt",
      honeypotData: { isHoneypot: true, buyTax: null, sellTax: null, risk: "high", reason: "x", error: null },
      isScamFlagged: false,
      scamCheckedAt: NOW,
    });
    const t1 = await seedToken({ coingeckoCoinId: "weth" });
    const pair = await seedPair(t0.id, t1.id, { status: TokenPairStatus.AutoVerified });

    const out = await rescoreScamForToken(t0.id, { now: NOW });
    expect(out.changed).toBe(true);
    expect(out.flagged).toBe(true);
    expect((await testPrisma.pair.findUnique({ where: { id: pair.id } }))?.status).toBe(TokenPairStatus.NeedsReview);
  });

  it("does NOT clear a honeypot-set flag when the cached GoPlus data is clean (no clobber, B2)", async () => {
    // The regression this guards: a GoPlus-only rescore would derive "clean" and
    // wrongly clear a flag honeypot.is set. The combined rule keeps it flagged.
    const t0 = await seedToken({
      coingeckoCoinId: "bgpt",
      goPlusData: { is_honeypot: "0", buy_tax: "0", sell_tax: "0" },
      honeypotData: { isHoneypot: true, buyTax: null, sellTax: null, risk: "high", reason: "x", error: null },
      isScamFlagged: true,
      scamReason: "honeypot (simulated buy/sell)",
      scamCheckedAt: NOW,
    });
    const t1 = await seedToken({ coingeckoCoinId: "weth" });
    await seedPair(t0.id, t1.id, { status: TokenPairStatus.NeedsReview });

    const out = await rescoreScamForToken(t0.id, { now: NOW });
    expect(out.changed).toBe(false);
    expect(out.flagged).toBe(true);
  });
});

describe("tokensToRescore", () => {
  it("returns scam-checked tokens (scamCheckedAt > 0), excludes never-checked", async () => {
    const checked = await seedToken({ coingeckoCoinId: "weth", scamCheckedAt: NOW });
    await seedToken({ coingeckoCoinId: "usd-coin", decimals: 6 }); // never checked → scamCheckedAt 0
    expect(await tokensToRescore()).toEqual([checked.id]);
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
