// Headless proactive canonical-address resolution (Phase 5, T3) — thin CLI over
// the shared canonicalPass (lib/pipeline.ts). Resolves CoinGecko-canonical
// contracts so the impostor fence runs on every pair. Run after an ingest:
//   yarn canonicalcheck
// Set GECKO_API_KEY in .env to use the keyed (faster) CoinGecko rate limit.

import { canonicalPass, targetDb } from "../lib/pipeline";
import prisma from "../lib/prisma";

const main = async (): Promise<void> => {
  console.log(`Resolving canonical addresses for pair tokens in "${targetDb()}"…`);
  const s = await canonicalPass({ log: (m) => console.log(`  ${m}`) });
  console.log(`Done. ${s.total} tokens checked, ${s.resolved} canonical addresses resolved, ${s.impostorPairs} pairs routed to review.`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
