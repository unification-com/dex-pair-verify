// lib/merkleVerify.ts
// BROWSER-safe independent verifier for a pair's BEACON anchor proof (#130 S3). Recomputes the Merkle
// leaf from the published PREIMAGE and walks the proof to a root entirely in the browser via the Web
// Crypto API — so the "Verify" affordance proves the pair → root WITHOUT trusting the server's asserted
// leaf/root. Shares the exact canonicalisation with the node builder via merkleCore.ts (DRY), differing
// only in the sha256 backend. No node `crypto` import → safe in a client bundle.
import { LEAF_PREFIX_BYTE, MerkleProof, NODE_PREFIX_BYTE, stableStringify } from "./merkleCore";

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
};

const hexToBytes = (hex: string): Uint8Array => {
  const m = hex.match(/.{2}/g);
  return m ? Uint8Array.from(m.map((b) => parseInt(b, 16))) : new Uint8Array();
};

const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
};

// One hashing step on the way leaf→root: combine the running hash with the proof's sibling (on the given
// side) to get the parent hash. Exposed so the UI can SHOW the actual proof walk, not just a yes/no.
export type TraceStep = { sibling: string; position: "left" | "right"; result: string };
export type VerifyTrace = {
  leaf: string; // the leaf hash recomputed from the preimage (independent of the server's asserted leaf)
  steps: TraceStep[]; // each branch combine up the tree
  computedRoot: string; // the root this walk arrives at
  ok: boolean; // computedRoot === the on-chain-recorded root
};

// Recompute the root from the leaf PREIMAGE + proof and return the full step-by-step trace. The preimage
// is the canonical leaf object /api/ooo/v1/anchor publishes; we re-derive the leaf from it (not the
// server's asserted leaf) and walk each branch to a root, so the trace is an independent reconstruction.
export async function traceLeafPreimage(preimage: unknown, proof: MerkleProof, rootHex: string): Promise<VerifyTrace> {
  const enc = new TextEncoder();
  let h = await sha256(concat(Uint8Array.of(LEAF_PREFIX_BYTE), enc.encode(stableStringify(preimage))));
  const leaf = bytesToHex(h);
  const steps: TraceStep[] = [];
  for (const step of proof) {
    const sib = hexToBytes(step.hash);
    const node = step.position === "left" ? concat(Uint8Array.of(NODE_PREFIX_BYTE), sib, h) : concat(Uint8Array.of(NODE_PREFIX_BYTE), h, sib);
    h = await sha256(node);
    steps.push({ sibling: step.hash, position: step.position, result: bytesToHex(h) });
  }
  const computedRoot = bytesToHex(h);
  return { leaf, steps, computedRoot, ok: computedRoot === rootHex && rootHex.length === 64 };
}

// Boolean convenience over traceLeafPreimage (kept for callers/tests that only need the verdict).
export async function verifyLeafPreimage(preimage: unknown, proof: MerkleProof, rootHex: string): Promise<boolean> {
  return (await traceLeafPreimage(preimage, proof, rootHex)).ok;
}
