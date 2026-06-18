// lib/anchor.ts
// dpv anchor snapshots: TWO Merkle trees (#130) — one over every verified PAIR's durable verdict facts,
// one over every verified TOKEN's durable identity facts. Each yields a root + per-item proof + leaf
// preimage so a third party can recompute the root and verify any pair/token. The committed facts reuse
// the export's `trustScore` (pairs) so the anchor matches the feed by construction.
//
// Both snapshots are memoised on the SAME watermark — `pairsModifiedAt({})` (max lastChecked/verdictAt
// over ALL pairs). It is a valid signal for tokens too: a token's verdict only changes inside a pipeline
// run (which bumps pair lastChecked/verdictAt) or via the manual token form (which cascades the status to
// the token's pairs, bumping their verdictAt) — so token changes always co-occur with a pair-watermark
// advance. The per-minute beacon heartbeat re-stamps the cached roots between changes. Server-only.
import { pairsModifiedAt, trustScore } from "./export";
import { buildMerkle, LeafInput, MerkleProof, pairLeafInput, PairCommitment, tokenLeafInput } from "./merkle";
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
  root: string; // "" when the set is empty
  leafCount: number;
  modifiedAt: number; // the watermark the root is keyed on
  generatedAt: number; // when this root was (re)computed
  leaves: AnchorLeaf[]; // committed (sorted) order
};

const toSnapshot = (tree: { root: string; leafCount: number; leaves: { key: string; leaf: string; proof: MerkleProof }[] }, preimages: Map<string, Record<string, unknown>>, modifiedAt: number, now: number): AnchorSnapshot => ({
  root: tree.root,
  leafCount: tree.leafCount,
  modifiedAt,
  generatedAt: now,
  leaves: tree.leaves.map((l) => ({ key: l.key, preimage: preimages.get(l.key) ?? {}, leaf: l.leaf, proof: l.proof })),
});

const snapshotOf = (inputs: LeafInput[], modifiedAt: number, now: number): AnchorSnapshot =>
  toSnapshot(buildMerkle(inputs), new Map(inputs.map((i) => [i.key, i.preimage])), modifiedAt, now);

const tokenSelect = { chain: true, symbol: true, name: true, contractAddress: true, coingeckoCoinId: true } as const;

let pairCache: AnchorSnapshot | null = null;
let tokenCache: AnchorSnapshot | null = null;

// The PAIR tree: every verified pair's durable verdict facts. Memoised on the modified-at watermark.
export async function getAnchorSnapshot(opts: { now?: number; force?: boolean } = {}): Promise<AnchorSnapshot> {
  const modifiedAt = await pairsModifiedAt({});
  if (!opts.force && pairCache && pairCache.modifiedAt === modifiedAt) {
    return pairCache;
  }
  const data = await prisma.pair.findMany({
    where: { status: { in: VERIFIED } },
    include: { token0: { select: tokenSelect }, token1: { select: tokenSelect } },
  });
  const inputs = data.map((d) => {
    const c: PairCommitment = {
      chain: d.chain,
      dex: d.dex,
      contractAddress: d.contractAddress,
      status: d.status,
      confidence: trustScore(d.status, d.confidence),
      canonicalKey: d.canonicalKey,
      token0: d.token0,
      token1: d.token1,
    };
    return pairLeafInput(c);
  });
  pairCache = snapshotOf(inputs, modifiedAt, opts.now ?? nowSeconds());
  return pairCache;
}

// The TOKEN tree: every verified token's durable identity + verdict. Memoised on the same watermark.
export async function getTokenAnchorSnapshot(opts: { now?: number; force?: boolean } = {}): Promise<AnchorSnapshot> {
  const modifiedAt = await pairsModifiedAt({});
  if (!opts.force && tokenCache && tokenCache.modifiedAt === modifiedAt) {
    return tokenCache;
  }
  const tokens = await prisma.token.findMany({
    where: { status: { in: VERIFIED } },
    select: { chain: true, contractAddress: true, symbol: true, name: true, coingeckoCoinId: true, status: true },
  });
  const inputs = tokens.map((t) => tokenLeafInput(t));
  tokenCache = snapshotOf(inputs, modifiedAt, opts.now ?? nowSeconds());
  return tokenCache;
}

// The on-chain record (BeaconAnchor row) of a given root, latest first — null until the worker anchors it.
// A root identifies its tree (pair roots ≠ token roots — the leaf `kind` differs), so a lookup by root is
// unambiguous across both trees.
export type OnChainAnchor = { beaconId: number; timestampId: number; txHash: string; submitTime: number; metadata: string; tree: string };

export async function getOnChainAnchor(root: string): Promise<OnChainAnchor | null> {
  if (!root) {
    return null;
  }
  const a = await prisma.beaconAnchor.findFirst({ where: { root }, orderBy: { timestampId: "desc" } });
  return a ? { beaconId: a.beaconId, timestampId: a.timestampId, txHash: a.txHash, submitTime: a.submitTime, metadata: a.metadata, tree: a.tree } : null;
}

type LeafResult = { root: string; modifiedAt: number; generatedAt: number; leaf: AnchorLeaf };

const findLeaf = (snap: AnchorSnapshot, key: string): LeafResult | null => {
  const leaf = snap.leaves.find((l) => l.key === key);
  return leaf ? { root: snap.root, modifiedAt: snap.modifiedAt, generatedAt: snap.generatedAt, leaf } : null;
};

// A single pair's published leaf (preimage + proof) for the pair-page badge, or null.
export async function getAnchorLeaf(chain: string, dex: string, contractAddress: string): Promise<LeafResult | null> {
  return findLeaf(await getAnchorSnapshot(), `${chain}/${dex}/${contractAddress}`);
}

// A single token's published leaf (preimage + proof) for the token-page badge, or null.
export async function getTokenAnchorLeaf(chain: string, contractAddress: string): Promise<LeafResult | null> {
  return findLeaf(await getTokenAnchorSnapshot(), `${chain}/${contractAddress}`);
}

// Test/maintenance hook to drop the in-memory memos.
export const _clearAnchorCache = (): void => {
  pairCache = null;
  tokenCache = null;
};
