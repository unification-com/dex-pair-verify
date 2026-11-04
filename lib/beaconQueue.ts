// lib/beaconQueue.ts
// The BEACON anchor-drip backlog (#130). Generic over the STREAM: each row is a single 64-char hash to
// record on-chain one tx per block — a pair/token LEAF (so every item gets a direct on-chain timestamp,
// not only a Merkle proof) or an OoO FULFILMENT receipt (path ii). Unique on (stream, hash) so each
// distinct hash is anchored exactly once: a changed verdict yields a new leaf hash → a new pending row →
// re-anchored. `metadata` is the off-chain descriptor (it becomes the on-chain #129 metadata field later).
import prisma from "./prisma";

// "reanchor" is the one-time #129 backlog: every pre-upgrade anchor re-queued to be re-recorded WITH
// metadata once the vaxildan upgrade lands (see seedReanchorBacklog). It drains through the same drip path.
export type Stream = "pair-leaf" | "token-leaf" | "fulfilment" | "reanchor";
export type QueueItem = { id: number; stream: string; refKey: string; hash: string; metadata: string };

// Tag a descriptor as a re-anchor (preserves the original provenance, adds the marker, stays within the
// on-chain 256-byte metadata cap). Idempotent — re-tagging an already-tagged descriptor is a no-op.
const reanchorMeta = (m: string): string => (m.includes("reanchor=1") ? m : `${m};reanchor=1`).slice(0, 256);

// Generic enqueue — rows whose (stream, hash) already exist are skipped (idempotent). Returns count added.
export async function enqueue(items: { stream: string; refKey: string; hash: string; metadata: string }[], now: number): Promise<number> {
  if (items.length === 0) {
    return 0;
  }
  const res = await prisma.beaconQueue.createMany({ data: items.map((i) => ({ ...i, createdAt: now })), skipDuplicates: true });
  return res.count;
}

// Enqueue a tree's current leaves (only new/changed hashes survive the (stream, hash) dedupe).
export async function enqueueLeaves(tree: "pairs" | "tokens", leaves: { key: string; leaf: string }[], root: string, now: number): Promise<number> {
  const stream: Stream = tree === "pairs" ? "pair-leaf" : "token-leaf";
  return enqueue(leaves.map((l) => ({ stream, refKey: l.key, hash: l.leaf, metadata: `type=leaf;tree=${tree};root=${root.slice(0, 16)}` })), now);
}

// Enqueue OoO fulfilment receipts (path ii). refKey/metadata carry the chain/router/requestId context.
export async function enqueueFulfilments(receipts: { refKey: string; hash: string; metadata: string }[], now: number): Promise<number> {
  return enqueue(receipts.map((r) => ({ stream: "fulfilment" as Stream, refKey: r.refKey, hash: r.hash, metadata: r.metadata })), now);
}

// The oldest pending (unanchored) item, or null when the backlog is drained.
export async function nextPending(): Promise<QueueItem | null> {
  return prisma.beaconQueue.findFirst({
    where: { anchoredAt: null },
    orderBy: { id: "asc" },
    select: { id: true, stream: true, refKey: true, hash: true, metadata: true },
  });
}

export async function markAnchored(id: number, timestampId: number, txHash: string, at: number): Promise<void> {
  await prisma.beaconQueue.update({ where: { id }, data: { timestampId, txHash, anchoredAt: at } });
}

export async function queueStats(): Promise<{ pending: number; anchored: number }> {
  const [pending, anchored] = await Promise.all([
    prisma.beaconQueue.count({ where: { anchoredAt: null } }),
    prisma.beaconQueue.count({ where: { anchoredAt: { not: null } } }),
  ]);
  return { pending, anchored };
}

// Seed the one-time re-anchor backlog (#129): re-queue every pre-upgrade anchor as a `reanchor` row so the
// drip re-records it WITH metadata now the chain is upgraded. Covers EVERYTHING except heartbeats —
// - leaves + fulfilments: every already-anchored queue row (its `metadata` was kept off-chain, now applied);
// - roots: ONE row per DISTINCT (tree, root) — the per-heartbeat re-stamps of an unchanged root collapse to
//   a single re-anchor (those re-stamps ARE the liveness heartbeat, deliberately not re-anchored).
// Idempotent: `reanchor` rows are unique on (stream, hash), so a re-run (or a hash already re-anchored)
// skips. A leaf/fulfilment recorded AFTER go-live is born with metadata and is never seeded. Returns rows added.
export async function seedReanchorBacklog(now: number): Promise<number> {
  const anchored = await prisma.beaconQueue.findMany({
    where: { anchoredAt: { not: null }, stream: { in: ["pair-leaf", "token-leaf", "fulfilment"] } },
    select: { refKey: true, hash: true, metadata: true },
  });
  const roots = await prisma.beaconAnchor.findMany({
    distinct: ["tree", "root"],
    orderBy: { submitTime: "asc" }, // first sighting of each root (its changed=1 record)
    select: { tree: true, root: true, metadata: true },
  });
  const rows = [
    ...anchored.map((a) => ({ stream: "reanchor", refKey: a.refKey, hash: a.hash, metadata: reanchorMeta(a.metadata) })),
    ...roots.map((r) => ({ stream: "reanchor", refKey: `root:${r.tree}`, hash: r.root, metadata: reanchorMeta(r.metadata) })),
  ];
  return enqueue(rows, now);
}

// --- per-chain block cursor for the fulfilment watcher ----------------------------------------------

export async function getCursor(chainId: number): Promise<number> {
  const c = await prisma.beaconWatchCursor.findUnique({ where: { chainId } });
  return c?.lastBlock ?? 0;
}

export async function setCursor(chainId: number, lastBlock: number, now: number): Promise<void> {
  await prisma.beaconWatchCursor.upsert({
    where: { chainId },
    create: { chainId, lastBlock, updatedAt: now },
    update: { lastBlock, updatedAt: now },
  });
}
