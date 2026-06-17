// Integration tests for the BEACON anchor snapshot (#130) against the test DB: the Merkle root is built
// over VERIFIED pairs only, every pair's proof verifies, the leaf preimage excludes volatile market data,
// per-pair lookup works, and the snapshot is memoised on the modified-at watermark (recomputed only when a
// verdict changes). The Merkle maths itself is unit-tested in merkle.test.ts; this proves the DB wiring.
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, seedPair, seedToken, testPrisma } from "./helpers";
import { _clearAnchorCache, getAnchorLeaf, getAnchorSnapshot } from "../../lib/anchor";
import { verifyProof } from "../../lib/merkle";

beforeEach(async () => {
  await resetDb();
  _clearAnchorCache(); // the snapshot memo is module-level — clear it so a prior test's root can't leak
});
afterAll(async () => {
  await testPrisma.$disconnect();
});

// Seed a verified pair between two fresh tokens; returns the pair row.
const verifiedPair = async (over = {}) => {
  const t0 = await seedToken({ symbol: "WETH", coingeckoCoinId: "weth" });
  const t1 = await seedToken({ symbol: "USDC", coingeckoCoinId: "usd-coin" });
  return seedPair(t0.id, t1.id, { status: "AutoVerified", confidence: 0.9876, canonicalKey: "usd-coin:weth", verdictAt: 1000, lastChecked: 1000, ...over });
};

describe("anchor snapshot (BEACON #130)", () => {
  it("commits VERIFIED pairs only, and every proof verifies against the root", async () => {
    await verifiedPair({ canonicalKey: "usd-coin:weth" });
    await verifiedPair({ canonicalKey: "tether:weth" });
    // A non-verified pair must NOT enter the anchored set.
    const t0 = await seedToken({ symbol: "SCAM", coingeckoCoinId: "" });
    const t1 = await seedToken({ symbol: "USDC", coingeckoCoinId: "usd-coin" });
    await seedPair(t0.id, t1.id, { status: "NeedsReview", verdictAt: 1500, lastChecked: 1500 });

    const snap = await getAnchorSnapshot({ force: true });
    expect(snap.leafCount).toBe(2);
    expect(snap.root).toHaveLength(64);
    for (const lp of snap.leaves) {
      expect(verifyProof(lp.leaf, lp.proof, snap.root)).toBe(true);
    }
  });

  it("the leaf preimage carries durable facts and excludes volatile market data", async () => {
    await verifiedPair({ confidence: 0.9876 });
    const snap = await getAnchorSnapshot({ force: true });
    const pre = snap.leaves[0].preimage as Record<string, unknown>;
    expect(pre.confidenceE4).toBe(9876); // quantised to 4 dp
    expect(pre.canonicalKey).toBe("usd-coin:weth");
    expect(JSON.stringify(pre)).not.toMatch(/reserve|volume|txcount/i);
  });

  it("a ManualVerified pair commits confidence 1 (operator-vouched)", async () => {
    await verifiedPair({ status: "ManualVerified", confidence: 0.4 });
    const snap = await getAnchorSnapshot({ force: true });
    expect((snap.leaves[0].preimage as { confidenceE4: number }).confidenceE4).toBe(10000);
    expect((snap.leaves[0].preimage as { status: string }).status).toBe("ManualVerified");
  });

  it("getAnchorLeaf returns a verified pair's proof, null for an absent pair", async () => {
    const p = await verifiedPair();
    const got = await getAnchorLeaf(p.chain, p.dex, p.contractAddress);
    expect(got).not.toBeNull();
    expect(verifyProof(got!.leaf.leaf, got!.leaf.proof, got!.root)).toBe(true);
    expect(await getAnchorLeaf("eth", "nope", "0xabsent")).toBeNull();
  });

  it("memoises on the modified-at watermark — recomputes only when a verdict changes", async () => {
    await verifiedPair({ verdictAt: 1000, lastChecked: 1000 });
    _clearAnchorCache();

    await getAnchorSnapshot({ now: 111 }); // populates the memo at generatedAt 111
    const s2 = await getAnchorSnapshot({ now: 222 }); // watermark unchanged → cache hit
    expect(s2.generatedAt).toBe(111);
    expect(s2.leafCount).toBe(1);

    await verifiedPair({ canonicalKey: "tether:weth", verdictAt: 2000, lastChecked: 2000 }); // advances the watermark
    const s3 = await getAnchorSnapshot({ now: 333 });
    expect(s3.generatedAt).toBe(333); // recomputed
    expect(s3.leafCount).toBe(2);

    const s4 = await getAnchorSnapshot({ now: 444, force: true }); // force bypasses the memo
    expect(s4.generatedAt).toBe(444);
  });
});
