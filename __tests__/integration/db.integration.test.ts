// Integration tests for import/db.js helpers against a real Postgres test
// DB. Covers the find-or-create contract of each helper + the B14
// regression (getOrCreateEmptyThresholds must report created=true on
// insert).
//
// Requires `.env.test` + `yarn db:push:test`. The setup file
// (./setup.ts) loads the test env before db.js instantiates its client.

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, testPrisma } from "./helpers";
import dbModule from "../../import/db.js";

// db.js is a CommonJS module (module.exports) with no .d.ts; esModuleInterop
// synthesises the default. Cast to a loose record so the `[entity, created]`
// tuples destructure cleanly — these are plain async helpers under test.
const db = dbModule as unknown as Record<string, (...args: any[]) => Promise<[any, boolean]>>;

const T0 = "0x1111111111111111111111111111111111111111";
const T1 = "0x2222222222222222222222222222222222222222";
const PAIR = "0x3333333333333333333333333333333333333333";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("getOrAddToken", () => {
  it("creates a new token and reports created=true", async () => {
    const [token, created] = await db.getOrAddToken("eth", T0, "Token Zero", "TKN0", 100, 0, "");
    expect(created).toBe(true);
    expect(token.symbol).toBe("TKN0");
    expect(token.chain).toBe("eth");
  });

  it("is idempotent — second call returns the same row with created=false", async () => {
    const [first] = await db.getOrAddToken("eth", T0, "Token Zero", "TKN0", 100, 0, "");
    const [second, created] = await db.getOrAddToken("eth", T0, "Token Zero", "TKN0", 100, 0, "");
    expect(created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(await testPrisma.token.count()).toBe(1);
  });
});

describe("getOrAddStagingPair", () => {
  it("creates a staging row and reports created=true", async () => {
    const [staging, created] = await db.getOrAddStagingPair("eth", "uniswap_v2", PAIR, T0, T1);
    expect(created).toBe(true);
    expect(staging.dex).toBe("uniswap_v2");
  });

  it("is idempotent on repeat", async () => {
    await db.getOrAddStagingPair("eth", "uniswap_v2", PAIR, T0, T1);
    const [, created] = await db.getOrAddStagingPair("eth", "uniswap_v2", PAIR, T0, T1);
    expect(created).toBe(false);
    expect(await testPrisma.pairStaging.count()).toBe(1);
  });
});

describe("getOrAddPair", () => {
  it("creates a pair linked to two tokens and reports created=true", async () => {
    const [t0] = await db.getOrAddToken("eth", T0, "Token Zero", "TKN0", 100, 0, "");
    const [t1] = await db.getOrAddToken("eth", T1, "Token One", "TKN1", 200, 0, "");

    const [pair, created] = await db.getOrAddPair(
      "eth", "uniswap_v2", PAIR, "TKN0-TKN1",
      t0.id, t1.id,
      "1000000", "500", "10", "20", "999", "12345",
      0, "",
    );

    expect(created).toBe(true);
    expect(pair.pair).toBe("TKN0-TKN1");
    expect(pair.token0Id).toBe(t0.id);
    expect(pair.token1Id).toBe(t1.id);
    expect(pair.reserveUsd).toBe(1000000);
    expect(pair.txCount).toBe(12345);
  });

  it("is idempotent on repeat", async () => {
    const [t0] = await db.getOrAddToken("eth", T0, "Token Zero", "TKN0", 100, 0, "");
    const [t1] = await db.getOrAddToken("eth", T1, "Token One", "TKN1", 200, 0, "");
    const args = [
      "eth", "uniswap_v2", PAIR, "TKN0-TKN1",
      t0.id, t1.id,
      "1000000", "500", "10", "20", "999", "12345",
      0, "",
    ];
    await db.getOrAddPair(...args);
    const [, created] = await db.getOrAddPair(...args);
    expect(created).toBe(false);
    expect(await testPrisma.pair.count()).toBe(1);
  });
});

describe("getOrCreateEmptyThresholds (B14 regression)", () => {
  it("reports created=true when it inserts a new threshold row", async () => {
    const [threshold, created] = await db.getOrCreateEmptyThresholds("eth", "uniswap_v2");
    // B14: before the fix this returned `false` even on a fresh insert.
    expect(created).toBe(true);
    expect(threshold.minLiquidityUsd).toBe(0);
    expect(threshold.minTxCount).toBe(0);
  });

  it("reports created=false when the row already exists", async () => {
    await db.getOrCreateEmptyThresholds("eth", "uniswap_v2");
    const [, created] = await db.getOrCreateEmptyThresholds("eth", "uniswap_v2");
    expect(created).toBe(false);
    expect(await testPrisma.threshold.count()).toBe(1);
  });
});

describe("getOrAddDuplicateTokenSymbol", () => {
  it("creates a duplicate-symbol link and is idempotent", async () => {
    const [t0] = await db.getOrAddToken("eth", T0, "Token Zero", "DUP", 100, 0, "");
    const [t1] = await db.getOrAddToken("eth", T1, "Token Zero Clone", "DUP", 200, 0, "");

    const [, created1] = await db.getOrAddDuplicateTokenSymbol("eth", t0.id, t1.id);
    const [, created2] = await db.getOrAddDuplicateTokenSymbol("eth", t0.id, t1.id);

    expect(created1).toBe(true);
    expect(created2).toBe(false);
    expect(await testPrisma.duplicateTokenSymbols.count()).toBe(1);
  });
});

describe("getOrAddDuplicatePair", () => {
  it("creates a duplicate-pair link and is idempotent", async () => {
    const [t0] = await db.getOrAddToken("eth", T0, "Token Zero", "TKN0", 100, 0, "");
    const [t1] = await db.getOrAddToken("eth", T1, "Token One", "TKN1", 200, 0, "");
    const [p0] = await db.getOrAddPair(
      "eth", "uniswap_v2", PAIR, "TKN0-TKN1",
      t0.id, t1.id, "1000000", "500", "10", "20", "999", "12345", 0, "",
    );
    const [p1] = await db.getOrAddPair(
      "eth", "sushiswap", PAIR, "TKN0-TKN1",
      t0.id, t1.id, "2000000", "600", "11", "21", "888", "54321", 0, "",
    );

    const [, created1] = await db.getOrAddDuplicatePair("eth", "uniswap_v2", p0.id, p1.id);
    const [, created2] = await db.getOrAddDuplicatePair("eth", "uniswap_v2", p0.id, p1.id);

    expect(created1).toBe(true);
    expect(created2).toBe(false);
    expect(await testPrisma.duplicatePairs.count()).toBe(1);
  });
});
