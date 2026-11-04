// Tests for lib/merkleVerify.ts — the BROWSER (Web Crypto) proof verifier (#130 S3). Locks the
// equivalence between the node tree-builder (lib/merkle) and the browser verifier: every leaf the node
// builder produces must verify from its PREIMAGE under the browser verifier, against the SAME root. This
// is what guarantees the in-browser "Verify proof" badge recomputes the identical root the server anchored
// (the two share lib/merkleCore but hash on different backends — node crypto vs crypto.subtle).
import { describe, expect, it } from "vitest";

import { buildMerkle } from "../../lib/merkle";
import { canonicalLeaf, pairLeafInput, PairCommitment, pairCommitmentKey } from "../../lib/merkleCore";
import { verifyLeafPreimage } from "../../lib/merkleVerify";

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

// An odd-count set (exercises the last-node duplication in the proof path too).
const SET: PairCommitment[] = [
  pair({ contractAddress: "0xaaa", canonicalKey: "usd-coin:weth" }),
  pair({ contractAddress: "0xbbb", canonicalKey: "tether:weth", dex: "sushiswap" }),
  pair({ contractAddress: "0xccc", canonicalKey: "bitcoin:usd-coin", token0: tok("WBTC", "wrapped-bitcoin"), token1: tok("USDC", "usd-coin") }),
  pair({ contractAddress: "0xddd", canonicalKey: "dai:weth" }),
  pair({ contractAddress: "0xeee", canonicalKey: "weth:wrapped-bitcoin" }),
];

const preimageByKey = new Map(SET.map((c) => [pairCommitmentKey(c), canonicalLeaf(c)]));

describe("merkleVerify (browser Web-Crypto) ≡ node builder", () => {
  it("verifies every leaf's proof from its preimage against the node root", async () => {
    const tree = buildMerkle(SET.map(pairLeafInput));
    expect(tree.root).toHaveLength(64);
    for (const lp of tree.leaves) {
      expect(await verifyLeafPreimage(preimageByKey.get(lp.key), lp.proof, tree.root)).toBe(true);
    }
  });

  it("rejects a tampered preimage (a verdict field flipped)", async () => {
    const tree = buildMerkle(SET.map(pairLeafInput));
    const lp = tree.leaves[0];
    const tampered = { ...(preimageByKey.get(lp.key) as Record<string, unknown>), status: "Hacked" };
    expect(await verifyLeafPreimage(tampered, lp.proof, tree.root)).toBe(false);
  });

  it("rejects a wrong root and a malformed root", async () => {
    const tree = buildMerkle(SET.map(pairLeafInput));
    const lp = tree.leaves[0];
    expect(await verifyLeafPreimage(preimageByKey.get(lp.key), lp.proof, "00".repeat(32))).toBe(false);
    expect(await verifyLeafPreimage(preimageByKey.get(lp.key), lp.proof, "abc")).toBe(false);
  });
});
