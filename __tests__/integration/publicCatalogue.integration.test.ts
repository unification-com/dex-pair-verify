// Integration tests for the PUBLIC supported-pairs catalogue (T10): the
// buildPublicPairsCatalogue builder + the ungated /api/pairs route. Asserts the
// dedup/grouping logic, that only verified pairs appear, and that the route is
// reachable WITHOUT auth + is cache/304-aware.

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, seedPair, seedToken, testPrisma } from "./helpers";
import { buildPublicPairsCatalogue } from "../../lib/export";
import { __resetRateLimit } from "../../lib/rateLimit";
import pairsHandler from "../../pages/api/pairs";
import { TokenPairStatus } from "../../types/types";

const NOW = 1_700_000_000;

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("buildPublicPairsCatalogue", () => {
  it("dedupes the same logical pair across DEXs into one entry", async () => {
    const weth = await seedToken({ symbol: "WETH", coingeckoCoinId: "weth" });
    const usdc = await seedToken({ symbol: "USDC", coingeckoCoinId: "usd-coin", decimals: 6 });
    await seedPair(weth.id, usdc.id, { status: TokenPairStatus.AutoVerified, canonicalKey: "usd-coin:weth", reserveUsd: 1_000_000 });
    await seedPair(weth.id, usdc.id, { status: TokenPairStatus.AutoVerified, dex: "sushiswap", canonicalKey: "usd-coin:weth", reserveUsd: 2_000_000 });

    const cat = await buildPublicPairsCatalogue({ now: NOW });

    expect(cat.schemaVersion).toBe(1);
    expect(cat.queryFormat).toBe("BASE.TARGET.AD");
    expect(cat.generatedAt).toBe(NOW);
    expect(cat.pairs).toHaveLength(1);
    const p = cat.pairs[0];
    expect(p.canonicalKey).toBe("usd-coin:weth");
    expect(p.sources).toBe(2);
    expect(p.chains).toEqual(["eth"]);
    expect(p.totalLiquidityUsd).toBe(3_000_000);
    // base/target deterministic by the canonical key's cgId order (usd-coin first).
    expect(p.base).toBe("USDC");
    expect(p.target).toBe("WETH");
  });

  it("excludes non-verified pairs (no trust internals leak)", async () => {
    const weth = await seedToken({ symbol: "WETH", coingeckoCoinId: "weth" });
    const usdc = await seedToken({ symbol: "USDC", coingeckoCoinId: "usd-coin", decimals: 6 });
    await seedPair(weth.id, usdc.id, { status: TokenPairStatus.NeedsReview, canonicalKey: "usd-coin:weth" });
    await seedPair(weth.id, usdc.id, { status: TokenPairStatus.AutoRejected, canonicalKey: "usd-coin:weth" });

    expect((await buildPublicPairsCatalogue({ now: NOW })).pairs).toHaveLength(0);
  });

  it("includes unkeyable (no-cgId) verified pairs grouped by symbol (canonicalKey null)", async () => {
    const a = await seedToken({ symbol: "AAA", coingeckoCoinId: "" });
    const b = await seedToken({ symbol: "BBB", coingeckoCoinId: "" });
    await seedPair(a.id, b.id, { status: TokenPairStatus.ManualVerified, canonicalKey: null });

    const cat = await buildPublicPairsCatalogue({ now: NOW });
    expect(cat.pairs).toHaveLength(1);
    expect(cat.pairs[0].canonicalKey).toBeNull();
    expect([cat.pairs[0].base, cat.pairs[0].target].sort()).toEqual(["AAA", "BBB"]);
  });

  it("sorts entries by total liquidity, deepest first", async () => {
    const weth = await seedToken({ symbol: "WETH", coingeckoCoinId: "weth" });
    const usdc = await seedToken({ symbol: "USDC", coingeckoCoinId: "usd-coin", decimals: 6 });
    const dai = await seedToken({ symbol: "DAI", coingeckoCoinId: "dai" });
    await seedPair(weth.id, usdc.id, { status: TokenPairStatus.AutoVerified, canonicalKey: "usd-coin:weth", reserveUsd: 100 });
    await seedPair(weth.id, dai.id, { status: TokenPairStatus.AutoVerified, canonicalKey: "dai:weth", reserveUsd: 9_000_000 });

    const cat = await buildPublicPairsCatalogue({ now: NOW });
    expect(cat.pairs.map((p) => p.canonicalKey)).toEqual(["dai:weth", "usd-coin:weth"]);
  });
});

// --- the ungated route -----------------------------------------------------

type MockRes = {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  ended: boolean;
  setHeader: (k: string, v: string) => void;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
  end: () => MockRes;
};

const mockRes = (): MockRes => {
  const res = { statusCode: 200, headers: {} as Record<string, string>, body: undefined as unknown, ended: false } as MockRes;
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockReq = (over: Record<string, unknown> = {}): any => ({ method: "GET", headers: {}, socket: { remoteAddress: "1.2.3.4" }, ...over });

describe("/api/pairs route (ungated)", () => {
  it("returns the catalogue WITHOUT any auth, with cache headers", async () => {
    const weth = await seedToken({ symbol: "WETH", coingeckoCoinId: "weth" });
    const usdc = await seedToken({ symbol: "USDC", coingeckoCoinId: "usd-coin", decimals: 6 });
    await seedPair(weth.id, usdc.id, { status: TokenPairStatus.AutoVerified, canonicalKey: "usd-coin:weth" });

    const res = mockRes();
    // No Authorization header at all — must still succeed.
    await pairsHandler(mockReq(), res as never);

    expect(res.statusCode).toBe(200);
    expect((res.body as { pairs: unknown[] }).pairs).toHaveLength(1);
    expect(res.headers["cache-control"]).toContain("public");
    expect(res.headers["last-modified"]).toBeTruthy();
  });

  it("405s a non-GET method", async () => {
    const res = mockRes();
    await pairsHandler(mockReq({ method: "POST" }), res as never);
    expect(res.statusCode).toBe(405);
  });

  it("304s when If-Modified-Since is newer than the last change", async () => {
    const weth = await seedToken({ symbol: "WETH", coingeckoCoinId: "weth" });
    const usdc = await seedToken({ symbol: "USDC", coingeckoCoinId: "usd-coin", decimals: 6 });
    await seedPair(weth.id, usdc.id, { status: TokenPairStatus.AutoVerified, canonicalKey: "usd-coin:weth", lastChecked: 1000 });

    const future = new Date(2_000_000_000 * 1000).toUTCString();
    const res = mockRes();
    await pairsHandler(mockReq({ headers: { "if-modified-since": future } }), res as never);
    expect(res.statusCode).toBe(304);
    expect(res.ended).toBe(true);
  });
});
