// Tests for lib/merkle.ts — the deterministic Merkle commitment over dpv's durable verification facts
// (#130 BEACON anchoring). Locks: stable ordering (input-order-independent root), proof verification for
// every leaf incl. odd counts (last-node duplication), confidence 4-dp quantisation, volatile-data
// exclusion, tamper detection, and a GOLDEN root so the exact hashing/serialisation can't drift silently.
import { describe, expect, it } from "vitest";

import { buildMerkle, canonicalLeaf, findProof, leafHash, MERKLE_LEAF_VERSION, PairCommitment, verifyProof } from "../../lib/merkle";

const tok = (symbol: string, cg: string): PairCommitment["token0"] => ({
  chain: "eth",
  symbol,
  name: symbol,
  contractAddress: `0x${symbol.toLowerCase().padStart(40, "0")}`,
  coingeckoCoinId: cg,
});

const pair = (over: Partial<PairCommitment> = {}): PairCommitment => ({
  chain: "eth",
  dex: "uniswap_v3",
  contractAddress: "0xpool",
  status: "AutoVerified",
  confidence: 0.9876,
  canonicalKey: "usd-coin:weth",
  token0: tok("WETH", "weth"),
  token1: tok("USDC", "usd-coin"),
  ...over,
});

// A representative multi-pair set (distinct pools / canonical keys).
const SET: PairCommitment[] = [
  pair({ contractAddress: "0xaaa", canonicalKey: "usd-coin:weth" }),
  pair({ contractAddress: "0xbbb", canonicalKey: "tether:weth", dex: "sushiswap" }),
  pair({ contractAddress: "0xccc", canonicalKey: "bitcoin:usd-coin", token0: tok("WBTC", "wrapped-bitcoin"), token1: tok("USDC", "usd-coin") }),
];

describe("buildMerkle determinism + ordering", () => {
  it("produces the same root regardless of input order", () => {
    const a = buildMerkle(SET);
    const b = buildMerkle([...SET].reverse());
    expect(a.root).toHaveLength(64);
    expect(a.root).toBe(b.root);
    expect(a.leafCount).toBe(3);
  });

  it("commits leaves in the sorted (canonicalKey, chain/dex/contract) order", () => {
    const r = buildMerkle(SET);
    // bitcoin:usd-coin < tether:weth < usd-coin:weth lexically
    expect(r.leaves.map((l) => l.key)).toEqual(["eth/uniswap_v3/0xccc", "eth/sushiswap/0xbbb", "eth/uniswap_v3/0xaaa"]);
  });
});

describe("proofs", () => {
  it("every leaf's proof verifies against the root", () => {
    const r = buildMerkle(SET);
    for (const lp of r.leaves) {
      expect(verifyProof(lp.leaf, lp.proof, r.root)).toBe(true);
    }
  });

  it("verifies for a single-leaf tree (empty proof)", () => {
    const r = buildMerkle([pair({ contractAddress: "0xsolo" })]);
    expect(r.leaves[0].proof).toEqual([]);
    expect(verifyProof(r.leaves[0].leaf, [], r.root)).toBe(true);
  });

  it("verifies for odd leaf counts (last-node duplication)", () => {
    for (const n of [3, 5, 7]) {
      const set = Array.from({ length: n }, (_, i) => pair({ contractAddress: `0x${i}`, canonicalKey: `k${i}:weth` }));
      const r = buildMerkle(set);
      expect(r.leafCount).toBe(n);
      for (const lp of r.leaves) {
        expect(verifyProof(lp.leaf, lp.proof, r.root)).toBe(true);
      }
    }
  });

  it("findProof returns a pool's proof by key", () => {
    const r = buildMerkle(SET);
    const lp = findProof(r, "eth/sushiswap/0xbbb");
    expect(lp).not.toBeNull();
    expect(verifyProof(lp!.leaf, lp!.proof, r.root)).toBe(true);
    expect(findProof(r, "eth/none/0xzzz")).toBeNull();
  });

  it("rejects a tampered leaf and a wrong root", () => {
    const r = buildMerkle(SET);
    const lp = r.leaves[0];
    const otherLeaf = r.leaves[1].leaf;
    expect(verifyProof(otherLeaf, lp.proof, r.root)).toBe(false); // wrong leaf for this proof
    expect(verifyProof(lp.leaf, lp.proof, "00".repeat(32))).toBe(false); // wrong root
  });
});

describe("leaf canonicalisation", () => {
  it("commits the durable facts and EXCLUDES volatile market data", () => {
    const leaf = canonicalLeaf(pair());
    expect(Object.keys(leaf).sort()).toEqual(
      ["canonicalKey", "chain", "confidenceE4", "contractAddress", "dex", "status", "token0", "token1", "v"].sort(),
    );
    // No reserve/volume/txCount ever enters the commitment.
    expect(JSON.stringify(leaf)).not.toMatch(/reserve|volume|txcount/i);
    expect(leaf.v).toBe(MERKLE_LEAF_VERSION);
  });

  it("quantises confidence to 4 dp — differences beyond 4 dp collapse, within 4 dp differ", () => {
    expect(leafHash(pair({ confidence: 0.98764 }))).toBe(leafHash(pair({ confidence: 0.987641 }))); // same 4-dp bucket
    expect(leafHash(pair({ confidence: 0.9876 }))).not.toBe(leafHash(pair({ confidence: 0.9877 }))); // 4-dp apart
    expect((canonicalLeaf(pair({ confidence: 0.9876 })) as { confidenceE4: number }).confidenceE4).toBe(9876);
  });

  it("a verdict change (status/confidence/identity) changes the leaf; market noise does not (not committed)", () => {
    const base = leafHash(pair());
    expect(leafHash(pair({ status: "ManualVerified" }))).not.toBe(base);
    expect(leafHash(pair({ confidence: 0.5 }))).not.toBe(base);
    expect(leafHash(pair({ canonicalKey: "tether:weth" }))).not.toBe(base);
  });
});

describe("empty + golden", () => {
  it("returns an empty root for no commitments", () => {
    expect(buildMerkle([])).toEqual({ root: "", leafCount: 0, leaves: [] });
  });

  it("matches the golden root (locks the exact hashing + serialisation)", () => {
    // Recompute with: node -e on buildMerkle(SET).root if the canonicalisation legitimately changes.
    expect(buildMerkle(SET).root).toBe("7b3dd94ef92db87b6ddb71387a5f54a2fd8d9bbec9aef1a5f02631889c1223de");
  });
});
