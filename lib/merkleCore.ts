// lib/merkleCore.ts
// Node-free CORE of the BEACON Merkle commitment (#130): the canonical leaf shape + deterministic
// serialisation + sort/key helpers + proof types. There is NO hashing here (no `crypto` import) so this
// module is safe in BOTH the Node tree-builder (lib/merkle.ts) and the BROWSER proof-verifier
// (lib/merkleVerify.ts) — they share this exact canonicalisation and differ only in the sha256 backend
// (node crypto vs Web Crypto). Keeping the canonicalisation in ONE place is what guarantees a browser
// recomputes the identical root the server anchored.
//
// Leaf commits the DURABLE verdict facts only (chain/dex/pool + token identities, status, confidence,
// canonicalKey); volatile market data is excluded. Determinism: recursively key-sorted JSON, confidence
// quantised to a 4-dp integer (no floats), leaves sorted by (canonicalKey, chain, dex, contract); hashing
// is RFC-6962 domain-separated (leaf 0x00, node 0x01).

// Bump if the committed field set or canonicalisation ever changes, so an old root can't be reinterpreted.
export const MERKLE_LEAF_VERSION = 1;

// RFC-6962-style domain-separation prefix bytes: leaf = sha256(0x00 ‖ json), node = sha256(0x01 ‖ l ‖ r).
export const LEAF_PREFIX_BYTE = 0x00;
export const NODE_PREFIX_BYTE = 0x01;

export type TokenCommitment = {
  chain: string;
  symbol: string;
  name: string;
  contractAddress: string;
  coingeckoCoinId: string;
};

// One verified pair's durable verification facts — the Merkle leaf preimage source.
export type PairCommitment = {
  chain: string;
  dex: string;
  contractAddress: string;
  status: string; // the verdict (e.g. AutoVerified / ManualVerified)
  confidence: number; // trust score in [0,1]; quantised to a 4-dp integer in the leaf
  canonicalKey: string | null;
  token0: TokenCommitment | null;
  token1: TokenCommitment | null;
};

// One verified TOKEN's durable identity facts — the leaf of the separate token tree (#130). A token's
// identity (chain/contract/symbol/name/cg id) + its verdict status; no volatile market data.
export type TokenLeafCommitment = {
  chain: string;
  contractAddress: string;
  symbol: string;
  name: string;
  coingeckoCoinId: string;
  status: string;
};

// A generic leaf the tree builder consumes: a stable lookup key, a deterministic sort key, and the
// canonical preimage that gets hashed. Pairs and tokens both map to this (one tree builder for both).
export type LeafInput = { key: string; sortKey: string; preimage: Record<string, unknown> };

// A proof step carries the SIBLING hash and which side it sits on, so verification re-hashes in order.
export type ProofStep = { hash: string; position: "left" | "right" };
export type MerkleProof = ProofStep[];

// One leaf's published artefact: a stable pair key (for badge lookup), the leaf hash, and its proof.
export type LeafProof = { key: string; leaf: string; proof: MerkleProof };

export type MerkleResult = {
  root: string; // 64-char hex; "" for an empty set
  leafCount: number;
  leaves: LeafProof[]; // in committed (sorted) order
};

// Recursive, key-sorted JSON — deterministic regardless of property insertion order. The input is built
// from strings/ints/null only (confidence is pre-quantised to an int), so there are no float-repr hazards.
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") {
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) {
    return `[${v.map(stableStringify).join(",")}]`;
  }
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

const canonicalToken = (t: TokenCommitment) => ({
  chain: t.chain,
  symbol: t.symbol,
  name: t.name,
  contractAddress: t.contractAddress,
  coingeckoCoinId: t.coingeckoCoinId,
});

// The canonical PAIR leaf object — the exact value committed. `kind` domain-separates it from a token
// leaf (so the two trees can never share a leaf). confidence → 4-dp integer (no floats); addresses
// committed AS-STORED (lower-cased EVM hex / case-sensitive Cosmos denom both stay stable from the DB).
export function canonicalLeaf(c: PairCommitment): Record<string, unknown> {
  return {
    v: MERKLE_LEAF_VERSION,
    kind: "pair",
    chain: c.chain,
    dex: c.dex,
    contractAddress: c.contractAddress,
    status: c.status,
    confidenceE4: Math.round((c.confidence ?? 0) * 1e4),
    canonicalKey: c.canonicalKey ?? null,
    token0: c.token0 ? canonicalToken(c.token0) : null,
    token1: c.token1 ? canonicalToken(c.token1) : null,
  };
}

// The canonical TOKEN leaf object — a token's durable identity + verdict (no market data).
export function canonicalTokenLeaf(t: TokenLeafCommitment): Record<string, unknown> {
  return {
    v: MERKLE_LEAF_VERSION,
    kind: "token",
    chain: t.chain,
    contractAddress: t.contractAddress,
    symbol: t.symbol,
    name: t.name,
    coingeckoCoinId: t.coingeckoCoinId,
    status: t.status,
  };
}

// A stable, unique key for a pool (used to look a pair's proof back up for the page badge).
export const pairCommitmentKey = (c: PairCommitment): string => `${c.chain}/${c.dex}/${c.contractAddress}`;

// A stable, unique key for a token.
export const tokenCommitmentKey = (t: TokenLeafCommitment): string => `${t.chain}/${t.contractAddress}`;

// The deterministic PAIR sort key — canonicalKey first (groups logical pairs), then chain/dex/contract as
// a stable tie-break. Space-joined; null canonicalKey sorts first ("").
export const sortKey = (c: PairCommitment): string => [c.canonicalKey ?? "", c.chain, c.dex, c.contractAddress].join(" ");

// Map a pair / token commitment to the generic LeafInput the tree builder consumes.
export const pairLeafInput = (c: PairCommitment): LeafInput => ({ key: pairCommitmentKey(c), sortKey: sortKey(c), preimage: canonicalLeaf(c) });
export const tokenLeafInput = (t: TokenLeafCommitment): LeafInput => ({
  key: tokenCommitmentKey(t),
  sortKey: [t.coingeckoCoinId ?? "", t.chain, t.contractAddress].join(" "), // cg id first (groups an asset), then chain/contract
  preimage: canonicalTokenLeaf(t),
});
