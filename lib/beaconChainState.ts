// lib/beaconChainState.ts
// The singleton (#129) metadata roll-out flag for the BEACON writer. Before the vaxildan upgrade the writer
// records hashes WITHOUT metadata; once it probes the chain and sees BeaconTimestampsByHash served, the
// upgrade has landed and `metadataLive` latches on for good (sticky — never re-probed once true). At that
// point a one-time `reanchor` backlog is seeded, tracked by `reanchorSeeded`. One row, id = 1.
import prisma from "./prisma";

const ROW = 1;

export type ChainState = { metadataLive: boolean; reanchorSeeded: boolean; detectedAt: number };

export async function getChainState(): Promise<ChainState> {
  const s = await prisma.beaconChainState.findUnique({ where: { id: ROW } });
  return { metadataLive: s?.metadataLive ?? false, reanchorSeeded: s?.reanchorSeeded ?? false, detectedAt: s?.detectedAt ?? 0 };
}

// Latch the upgrade as detected (idempotent — once true it stays true).
export async function markMetadataLive(now: number): Promise<void> {
  await prisma.beaconChainState.upsert({
    where: { id: ROW },
    create: { id: ROW, metadataLive: true, detectedAt: now },
    update: { metadataLive: true },
  });
}

export async function markReanchorSeeded(): Promise<void> {
  await prisma.beaconChainState.upsert({
    where: { id: ROW },
    create: { id: ROW, metadataLive: true, reanchorSeeded: true },
    update: { reanchorSeeded: true },
  });
}
