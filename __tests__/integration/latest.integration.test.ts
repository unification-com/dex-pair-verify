// Integration tests for lib/latest.ts: the /latest feed of newest pairs and tokens.

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, seedPair, seedToken, testPrisma } from "./helpers";
import { latestEntities } from "../../lib/latest";
import { LatestFilters } from "../../lib/latestFilters";
import { TokenPairStatus } from "../../types/types";

const ALL: LatestFilters = { kind: null, chain: null, dex: null, order: "added", limit: 50 };

// The feed as "kind:label" in order, for compact assertions.
const feed = async (f: Partial<LatestFilters>, operator = true): Promise<string[]> =>
  (await latestEntities({ ...ALL, ...f }, operator)).map((r) => `${r.kind}:${r.label}`);

beforeEach(async () => {
  await resetDb();
  // Created at 100..600, interleaving pairs and tokens across two chains.
  const ta = await seedToken({ symbol: "TA", chain: "eth", createdAt: 100, statusChangedAt: 900, status: TokenPairStatus.AutoVerified });
  const tb = await seedToken({ symbol: "TB", chain: "eth", createdAt: 300, statusChangedAt: 300 });
  const tc = await seedToken({ symbol: "TC", chain: "bsc", createdAt: 500, statusChangedAt: 500, status: TokenPairStatus.AutoVerified, isScamFlagged: true, scamReason: "honeypot" });
  await seedPair(ta.id, tb.id, { pair: "P1", chain: "eth", dex: "uniswap_v3", createdAt: 200, statusChangedAt: 0, status: TokenPairStatus.AutoVerified });
  await seedPair(tb.id, ta.id, { pair: "P2", chain: "eth", dex: "sushiswap", createdAt: 400, statusChangedAt: 400, status: TokenPairStatus.NeedsReview });
  await seedPair(tc.id, ta.id, { pair: "P3", chain: "bsc", dex: "pancakeswap", createdAt: 600, statusChangedAt: 600, status: TokenPairStatus.ManualVerified });
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("latestEntities", () => {
  it("merges pairs and tokens, newest added first", async () => {
    expect(await feed({})).toEqual(["pair:P3", "token:TC", "pair:P2", "token:TB", "pair:P1", "token:TA"]);
  });

  it("shows public visitors only verified rows and no scam-flagged tokens", async () => {
    expect(await feed({}, false)).toEqual(["pair:P3", "pair:P1", "token:TA"]);
  });

  it("filters by type and chain", async () => {
    expect(await feed({ kind: "token" })).toEqual(["token:TC", "token:TB", "token:TA"]);
    expect(await feed({ kind: "pair", chain: "bsc" })).toEqual(["pair:P3"]);
    expect(await feed({ chain: "eth" })).toEqual(["pair:P2", "token:TB", "pair:P1", "token:TA"]);
  });

  it("matches a token to a DEX filter through its pools", async () => {
    expect(await feed({ dex: "uniswap_v3" })).toEqual(["token:TB", "pair:P1", "token:TA"]);
    expect(await feed({ dex: "pancakeswap" })).toEqual(["pair:P3", "token:TC", "token:TA"]);
  });

  it("orders by latest status change, leaving out never-stamped rows", async () => {
    const rows = await latestEntities({ ...ALL, order: "changed" }, true);
    expect(rows.map((r) => `${r.kind}:${r.label}`)).toEqual(["token:TA", "pair:P3", "token:TC", "pair:P2", "token:TB"]);
    expect(rows[0].at).toBe(900);
  });

  it("caps the merged feed at the limit", async () => {
    expect(await feed({ limit: 2 })).toEqual(["pair:P3", "token:TC"]);
  });

  it("carries the scam reason for operators only", async () => {
    const [tc] = await latestEntities({ ...ALL, kind: "token", chain: "bsc" }, true);
    expect(tc).toMatchObject({ scamFlagged: true, scamReason: "honeypot" });
  });
});
