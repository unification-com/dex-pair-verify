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

// Recompute the root from the leaf preimage + proof and confirm it equals `rootHex`. The preimage is the
// canonical leaf object the /api/ooo/v1/anchor endpoint publishes; we re-derive the leaf hash from it
// (not the server's asserted leaf) so this is an independent check.
export async function verifyLeafPreimage(preimage: unknown, proof: MerkleProof, rootHex: string): Promise<boolean> {
  if (rootHex.length !== 64) {
    return false;
  }
  const enc = new TextEncoder();
  let h = await sha256(concat(Uint8Array.of(LEAF_PREFIX_BYTE), enc.encode(stableStringify(preimage))));
  for (const step of proof) {
    const sib = hexToBytes(step.hash);
    const node = step.position === "left" ? concat(Uint8Array.of(NODE_PREFIX_BYTE), sib, h) : concat(Uint8Array.of(NODE_PREFIX_BYTE), h, sib);
    h = await sha256(node);
  }
  return bytesToHex(h) === rootHex;
}
