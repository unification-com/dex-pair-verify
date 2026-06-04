// Headless on-chain factory check (Phase 5, T2) — thin CLI over the shared
// factoryPass (lib/pipeline.ts). Reads each pool's factory() and routes
// mismatches to review (a match raises confidence). Run after an ingest:
//   yarn factorycheck
// Factory is immutable per pool, so this is a one-time read per pair; a re-run
// only retries pairs a failed RPC left unread.

import "../lib/env";

import { factoryPass, targetDb } from "../lib/pipeline";
import prisma from "../lib/prisma";

const main = async (): Promise<void> => {
  console.log(`Factory-checking pairs in "${targetDb()}"…`);
  const s = await factoryPass({ log: (m) => console.log(`  ${m}`) });
  console.log(`Done. ${s.total} pairs checked, ${s.read} factories read, ${s.mismatches} routed to review (mismatch).`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
