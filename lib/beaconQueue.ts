// lib/beaconQueue.ts
// The BEACON anchor-drip backlog (#130). Generic over the STREAM: each row is a single 64-char hash to
// record on-chain one tx per block — a pair/token LEAF (so every item gets a direct on-chain timestamp,
// not only a Merkle proof) or an OoO FULFILMENT receipt (path ii). Unique on (stream, hash) so each
// distinct hash is anchored exactly once: a changed verdict yields a new leaf hash → a new pending row →
// re-anchored. `metadata` is the off-chain descriptor (it becomes the on-chain #129 metadata field later).
import prisma from "./prisma";

export type Stream = "pair-leaf" | "token-leaf" | "fulfilment";
export type QueueItem = { id: number; stream: string; refKey: string; hash: string; metadata: string };

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
