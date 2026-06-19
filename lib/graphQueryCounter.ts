// lib/graphQueryCounter.ts
// Self-tracked The Graph query counter (admin #3, Part B). The Graph exposes usage only in the Studio UI — no
// API — so dpv counts its own outbound gateway queries, keyed by calendar billing month. bumpGraphQuery() is
// called at every Graph-gateway fetch site (the ingest corroboration in gtAdapter + the verify/probe path in
// subgraphVerify). Fire-and-forget: it never throws and never blocks the query — a counter failure must not
// break ingestion. Volume is low (hundreds/day), so a per-query upsert is cheap; no batching needed.
import prisma from "./prisma";

// The Graph bills per calendar month; key the counter the same way (UTC).
export function currentPeriod(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function recordOne(): Promise<void> {
  const period = currentPeriod();
  const now = Math.floor(Date.now() / 1000);
  // Atomic upsert-increment — concurrent fire-and-forget bumps on a not-yet-existing period row would race
  // prisma.upsert's create path; Postgres ON CONFLICT resolves it in one statement.
  await prisma.$executeRaw`
    INSERT INTO "GraphQueryUsage" ("period", "count", "firstAt", "updatedAt")
    VALUES (${period}, 1, ${now}, ${now})
    ON CONFLICT ("period") DO UPDATE SET "count" = "GraphQueryUsage"."count" + 1, "updatedAt" = ${now}`;
}

// Record one outbound Graph-gateway query. Fire-and-forget; swallows all errors.
export function bumpGraphQuery(): void {
  void recordOne().catch(() => {});
}

export type GraphQueryUsage = { period: string; count: number; firstAt: number; updatedAt: number };

export async function graphQueryUsage(period: string = currentPeriod()): Promise<GraphQueryUsage | null> {
  const row = await prisma.graphQueryUsage.findUnique({ where: { period } });
  return row ? { period: row.period, count: row.count, firstAt: row.firstAt, updatedAt: row.updatedAt } : null;
}
