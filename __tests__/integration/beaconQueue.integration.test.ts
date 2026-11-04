// Integration tests for the BEACON anchor-drip queue (#130) against the test DB: enqueue is idempotent on
// (stream, hash), the drip drains oldest-first skipping anchored rows, leaves and fulfilments share the
// queue, and the per-chain watch cursor round-trips. Signing is exercised live against the devnet separately.
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, testPrisma } from "./helpers";
import { enqueueFulfilments, enqueueLeaves, getCursor, markAnchored, nextPending, queueStats, setCursor } from "../../lib/beaconQueue";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await testPrisma.$disconnect();
});

const leafOf = (n: number): { key: string; leaf: string } => ({ key: `eth/dex/0x${n}`, leaf: `${n}`.padStart(64, "0") });

describe("beacon anchor-drip queue (#130)", () => {
  it("enqueues new leaves, skips duplicates, drips oldest-first, marks anchored", async () => {
    expect(await enqueueLeaves("pairs", [leafOf(1), leafOf(2)], "root1", 100)).toBe(2);
    expect(await enqueueLeaves("pairs", [leafOf(1), leafOf(2)], "root1", 100)).toBe(0); // idempotent on (stream, hash)
    expect(await enqueueLeaves("pairs", [leafOf(3)], "root1", 100)).toBe(1);
    expect(await queueStats()).toEqual({ pending: 3, anchored: 0 });

    const first = await nextPending();
    expect(first?.hash).toBe(leafOf(1).leaf); // oldest first
    expect(first?.stream).toBe("pair-leaf");
    await markAnchored(first!.id, 7, "tx1", 200);
    expect(await queueStats()).toEqual({ pending: 2, anchored: 1 });

    const second = await nextPending();
    expect(second?.hash).toBe(leafOf(2).leaf); // anchored row skipped
  });

  it("shares the queue between leaf streams and fulfilments", async () => {
    await enqueueLeaves("tokens", [{ key: "eth/0xt", leaf: "t".repeat(64) }], "r", 1);
    const n = await enqueueFulfilments([{ refKey: "sepolia/0xr/0xq", hash: "f".repeat(64), metadata: "type=fulfil;net=sepolia" }], 1);
    expect(n).toBe(1);
    expect((await queueStats()).pending).toBe(2);
    // The same hash can recur across streams (token-leaf vs fulfilment) as distinct rows.
    expect(await enqueueFulfilments([{ refKey: "x", hash: "t".repeat(64), metadata: "" }], 1)).toBe(1);
    expect((await queueStats()).pending).toBe(3);
  });

  it("round-trips the per-chain watch cursor", async () => {
    expect(await getCursor(11155111)).toBe(0); // unset
    await setCursor(11155111, 5_000_000, 100);
    expect(await getCursor(11155111)).toBe(5_000_000);
    await setCursor(11155111, 5_001_000, 200); // upsert
    expect(await getCursor(11155111)).toBe(5_001_000);
  });

  it("returns null when the backlog is drained", async () => {
    expect(await nextPending()).toBeNull();
  });
});
