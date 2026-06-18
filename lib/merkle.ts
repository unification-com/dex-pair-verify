// lib/merkle.ts
// Node Merkle TREE BUILDER for the BEACON anchoring (#130). The canonical leaf shape + deterministic
// serialisation + types live in merkleCore.ts (shared with the browser verifier lib/merkleVerify.ts);
// this file adds the node-crypto sha256 + the tree build + per-leaf proofs. Server-only (Node `crypto`).
// See merkleCore.ts for the leaf shape, exclusions, ordering and domain-separation rules.
import { createHash } from "crypto";

import {
  canonicalLeaf,
  LEAF_PREFIX_BYTE,
  LeafInput,
  LeafProof,
  MerkleProof,
  MerkleResult,
  NODE_PREFIX_BYTE,
  PairCommitment,
  stableStringify,
} from "./merkleCore";

// Re-export the shared core so existing importers can keep importing from lib/merkle.
export * from "./merkleCore";

const LEAF_PREFIX = Buffer.from([LEAF_PREFIX_BYTE]);
const NODE_PREFIX = Buffer.from([NODE_PREFIX_BYTE]);

const sha256 = (b: Buffer): Buffer => createHash("sha256").update(b).digest();

// The leaf hash (hex) for a canonical preimage object.
export function leafHashOf(preimage: Record<string, unknown>): string {
  return sha256(Buffer.concat([LEAF_PREFIX, Buffer.from(stableStringify(preimage), "utf8")])).toString("hex");
}

// The leaf hash (hex) for one pair commitment (convenience).
export const leafHash = (c: PairCommitment): string => leafHashOf(canonicalLeaf(c));

// Hash two child nodes (domain-separated internal node).
const hashNode = (a: Buffer, b: Buffer): Buffer => sha256(Buffer.concat([NODE_PREFIX, a, b]));

// Build the Merkle tree + every leaf's proof over a set of generic leaf inputs (pairs OR tokens).
export function buildMerkle(inputs: LeafInput[]): MerkleResult {
  const entries = inputs
    .map((i) => ({ key: i.key, sortKey: i.sortKey, leaf: Buffer.from(leafHashOf(i.preimage), "hex") }))
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  if (entries.length === 0) {
    return { root: "", leafCount: 0, leaves: [] };
  }

  // Build the levels bottom-up, duplicating the last node on odd counts.
  const levels: Buffer[][] = [entries.map((e) => e.leaf)];
  while (levels[levels.length - 1].length > 1) {
    const cur = levels[levels.length - 1];
    const next: Buffer[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      const left = cur[i];
      const right = i + 1 < cur.length ? cur[i + 1] : cur[i]; // duplicate the last node on an odd level
      next.push(hashNode(left, right));
    }
    levels.push(next);
  }

  const root = levels[levels.length - 1][0].toString("hex");
  const leaves: LeafProof[] = entries.map((e, idx) => ({
    key: e.key,
    leaf: e.leaf.toString("hex"),
    proof: proofForIndex(levels, idx),
  }));
  return { root, leafCount: entries.length, leaves };
}

// The proof path for the leaf at `index`: at each level take the sibling, recording which side it is on.
function proofForIndex(levels: Buffer[][], index: number): MerkleProof {
  const proof: MerkleProof = [];
  let idx = index;
  for (let lvl = 0; lvl < levels.length - 1; lvl += 1) {
    const cur = levels[lvl];
    const isRightNode = idx % 2 === 1;
    const sibIdx = isRightNode ? idx - 1 : idx + 1;
    const sibling = sibIdx < cur.length ? cur[sibIdx] : cur[idx]; // the duplicated last node is its own sibling
    proof.push({ hash: sibling.toString("hex"), position: isRightNode ? "left" : "right" });
    idx = Math.floor(idx / 2);
  }
  return proof;
}

// Verify a leaf against a root using its proof. Re-hashes leaf→root with the same domain separation.
export function verifyProof(leafHex: string, proof: MerkleProof, rootHex: string): boolean {
  let h = Buffer.from(leafHex, "hex");
  for (const step of proof) {
    const sib = Buffer.from(step.hash, "hex");
    h = step.position === "left" ? hashNode(sib, h) : hashNode(h, sib);
  }
  return h.toString("hex") === rootHex && rootHex.length === 64;
}

// Convenience: the proof for a given pool key in a built result (null if absent).
export const findProof = (result: MerkleResult, key: string): LeafProof | null =>
  result.leaves.find((l) => l.key === key) ?? null;
