// lib/beaconQueue.ts
// The BEACON leaf-drip backlog (#130). Each verified pair / token leaf is anchored INDIVIDUALLY on-chain,
// one tx per block, so every item gets a direct on-chain timestamp (not only a Merkle proof). Unique on
// (tree, leafHash) so each distinct committed state is anchored exactly once: a changed verdict yields a
// new leaf hash → a new pending row → re-anchored. The worker drips the oldest pending row each tick.
import prisma from "./prisma";

export type QueuedLeaf = { id: number; tree: string; leafKey: string; leafHash: string };

// Enqueue a tree's current leaves; rows whose (tree, leafHash) already exist (pending OR anchored) are
// skipped, so this is idempotent + naturally captures only NEW/CHANGED leaves. Returns the count enqueued.
export async function enqueueLeaves(tree: string, leaves: { key: string; leaf: string }[], root: string, now: number): Promise<number> {
  if (leaves.length === 0) {
    return 0;
  }
  const res = await prisma.beaconQueue.createMany({
    data: leaves.map((l) => ({ tree, leafKey: l.key, leafHash: l.leaf, root, createdAt: now })),
    skipDuplicates: true,
  });
  return res.count;
}

// The oldest pending (unanchored) leaf, or null when the backlog is drained.
export async function nextPendingLeaf(): Promise<QueuedLeaf | null> {
  return prisma.beaconQueue.findFirst({
    where: { anchoredAt: null },
    orderBy: { id: "asc" },
    select: { id: true, tree: true, leafKey: true, leafHash: true },
  });
}

// Mark a queued leaf anchored (records the on-chain coordinates).
export async function markLeafAnchored(id: number, timestampId: number, txHash: string, at: number): Promise<void> {
  await prisma.beaconQueue.update({ where: { id }, data: { timestampId, txHash, anchoredAt: at } });
}

export async function queueStats(): Promise<{ pending: number; anchored: number }> {
  const [pending, anchored] = await Promise.all([
    prisma.beaconQueue.count({ where: { anchoredAt: null } }),
    prisma.beaconQueue.count({ where: { anchoredAt: { not: null } } }),
  ]);
  return { pending, anchored };
}
