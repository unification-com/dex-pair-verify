// Targeted first-party ingest (FUND / xFUND / FUNDx) — thin CLI over
// firstPartyIngestPass (lib/pipeline.ts). Pulls EVERY pool for our own tokens on
// the chains we ingest (the page-based ingest only takes top-ranked pools per DEX,
// so it misses them — FUND had 17 eth pools, 1 was ingested). Already folded into
// `yarn ingest` / `yarn pipeline`; this is for a quick standalone refresh:
//   yarn first-party
//
// Run the identity + verdict passes afterwards (or just `yarn pipeline`) so the
// freshly-pulled pairs get fully adjudicated.

import "../lib/env";

import { firstPartyIngestPass, targetDb } from "../lib/pipeline";
import prisma from "../lib/prisma";

const main = async (): Promise<void> => {
  console.log(`Pulling first-party (FUND/xFUND/FUNDx) pools into "${targetDb()}"…`);
  const s = await firstPartyIngestPass({ log: (m) => console.log(`  ${m}`) });
  console.log(`Done. ${s.pools} first-party pools ingested.`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
