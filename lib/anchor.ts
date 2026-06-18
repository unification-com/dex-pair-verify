// lib/anchor.ts
// The dpv anchor snapshot: a single Merkle root (lib/merkle.ts) over EVERY verified pair's DURABLE verdict
// facts, plus each pair's proof + leaf preimage so a third party can recompute the root and verify any
// pair. The committed facts are the SAME durable fields the provider export publishes — reusing
// `trustScore` so the anchor's confidence matches the feed by construction (no second source of truth).
//
// Cached on the GLOBAL modified-at watermark (`pairsModifiedAt({})` — max lastChecked/verdictAt over ALL
// pairs, so a DEMOTION advances it too): the root is recomputed only when a verdict actually changes; the
// per-minute beacon heartbeat (#130 S2) re-stamps the cached root between changes. Server-only.
import { pairsModifiedAt, trustScore } from "./export";
import { buildMerkle, canonicalLeaf, MerkleProof, pairCommitmentKey, PairCommitment } from "./merkle";
import prisma from "./prisma";
import { VERIFIED_STATUSES } from "./status";

const VERIFIED = [...VERIFIED_STATUSES];
const nowSeconds = (): number => Math.floor(Date.now() / 1000);

// One published leaf: its stable key, the durable preimage (so a verifier can recompute the hash), the
// leaf hash, and the proof path to the root.
export type AnchorLeaf = {
  key: string;
  preimage: Record<string, unknown>;
  leaf: string;
  proof: MerkleProof;
};

export type AnchorSnapshot = {
  root: string; // "" when there are no verified pairs
  leafCount: number;
  modifiedAt: number; // the watermark the root is keyed on
  generatedAt: number; // when this root was (re)computed
  leaves: AnchorLeaf[]; // committed (sorted) order
};

const tokenSelect = { chain: true, symbol: true, name: true, contractAddress: true, coingeckoCoinId: true } as const;

let cache: AnchorSnapshot | null = null;

// Build the durable Merkle snapshot over all verified pairs. Memoised on the modified-at watermark.
export async function getAnchorSnapshot(opts: { now?: number; force?: boolean } = {}): Promise<AnchorSnapshot> {
  const modifiedAt = await pairsModifiedAt({});
  if (!opts.force && cache && cache.modifiedAt === modifiedAt) {
    return cache;
  }

  const data = await prisma.pair.findMany({
    where: { status: { in: VERIFIED } },
    include: { token0: { select: tokenSelect }, token1: { select: tokenSelect } },
  });

  const commitments: PairCommitment[] = data.map((d) => ({
    chain: d.chain,
    dex: d.dex,
    contractAddress: d.contractAddress,
    status: d.status,
    confidence: trustScore(d.status, d.confidence),
    canonicalKey: d.canonicalKey,
    token0: d.token0,
    token1: d.token1,
  }));

  const preimages = new Map<string, Record<string, unknown>>(commitments.map((c) => [pairCommitmentKey(c), canonicalLeaf(c)]));
  const tree = buildMerkle(commitments);

  cache = {
    root: tree.root,
    leafCount: tree.leafCount,
    modifiedAt,
    generatedAt: opts.now ?? nowSeconds(),
    leaves: tree.leaves.map((l) => ({ key: l.key, preimage: preimages.get(l.key) ?? {}, leaf: l.leaf, proof: l.proof })),
  };
  return cache;
}

// The on-chain record (BeaconAnchor row) of a given root, latest first — null if that root has not been
// anchored yet (the worker re-stamps within a heartbeat of any verdict change, so this is null only in the
// brief window between a verdict change and the next beat).
export type OnChainAnchor = { beaconId: number; timestampId: number; txHash: string; submitTime: number; metadata: string };

export async function getOnChainAnchor(root: string): Promise<OnChainAnchor | null> {
  if (!root) {
    return null;
  }
  const a = await prisma.beaconAnchor.findFirst({ where: { root }, orderBy: { timestampId: "desc" } });
  return a ? { beaconId: a.beaconId, timestampId: a.timestampId, txHash: a.txHash, submitTime: a.submitTime, metadata: a.metadata } : null;
}

// A single pair's published leaf (preimage + proof) for the page badge / per-pair verify, or null.
export async function getAnchorLeaf(chain: string, dex: string, contractAddress: string): Promise<{ root: string; modifiedAt: number; generatedAt: number; leaf: AnchorLeaf } | null> {
  const snap = await getAnchorSnapshot();
  const key = `${chain}/${dex}/${contractAddress}`;
  const leaf = snap.leaves.find((l) => l.key === key);
  return leaf ? { root: snap.root, modifiedAt: snap.modifiedAt, generatedAt: snap.generatedAt, leaf } : null;
}

// Test/maintenance hook to drop the in-memory memo.
export const _clearAnchorCache = (): void => {
  cache = null;
};
