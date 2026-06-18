// Integration tests for the BEACON leaf-drip queue (#130) against the test DB: enqueue is idempotent on
// (tree, leafHash), the drip drains oldest-first skipping anchored rows, and the same leaf hash in different
// trees is distinct. The signing is exercised live against the devnet separately.
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, testPrisma } from "./helpers";
import { enqueueLeaves, markLeafAnchored, nextPendingLeaf, queueStats } from "../../lib/beaconQueue";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await testPrisma.$disconnect();
});

const leafOf = (n: number): { key: string; leaf: string } => ({ key: `eth/dex/0x${n}`, leaf: `${n}`.padStart(64, "0") });

describe("beacon leaf queue (#130)", () => {
  it("enqueues new leaves, skips duplicates, drips oldest-first, marks anchored", async () => {
    expect(await enqueueLeaves("pairs", [leafOf(1), leafOf(2)], "root1", 100)).toBe(2);
    expect(await enqueueLeaves("pairs", [leafOf(1), leafOf(2)], "root1", 100)).toBe(0); // idempotent on (tree, hash)
    expect(await enqueueLeaves("pairs", [leafOf(3)], "root1", 100)).toBe(1);
    expect(await queueStats()).toEqual({ pending: 3, anchored: 0 });

    const first = await nextPendingLeaf();
    expect(first?.leafHash).toBe(leafOf(1).leaf); // oldest first
    await markLeafAnchored(first!.id, 7, "tx1", 200);
    expect(await queueStats()).toEqual({ pending: 2, anchored: 1 });

    const second = await nextPendingLeaf();
    expect(second?.leafHash).toBe(leafOf(2).leaf); // anchored row skipped
  });

  it("keeps the same leaf hash distinct across trees", async () => {
    const same = "a".repeat(64);
    expect(await enqueueLeaves("pairs", [{ key: "k", leaf: same }], "r", 1)).toBe(1);
    expect(await enqueueLeaves("tokens", [{ key: "k", leaf: same }], "r", 1)).toBe(1); // (tree, hash) unique
    expect((await queueStats()).pending).toBe(2);
  });

  it("returns null when the backlog is drained", async () => {
    expect(await nextPendingLeaf()).toBeNull();
  });
});
