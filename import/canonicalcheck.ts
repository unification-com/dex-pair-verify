// Headless proactive canonical-address resolution (Phase 5, T3). Resolves the
// CoinGecko-canonical contract for every cgId-bearing pair token into the cache,
// then re-runs the verdict so the impostor fence runs on every pair. The CLI
// counterpart to /admin/canonicalcheck. Run after an ingest:
//   yarn canonicalcheck
//
// CoinGecko free tier rate-limits, so a first full run is slow (the shared 65s
// back-off paces it); resumable + cached via canonicalCheckedAt + the 30-day
// CanonicalAddress TTL.

import { countTokensToCanonicalCheck, runCanonicalCheckForToken, tokensToCanonicalCheck } from "../lib/canonicalCheck";
import prisma from "../lib/prisma";

const targetDb = (): string => {
  const url = process.env.POSTGRES_PRISMA_URL || "";
  const match = url.match(/\/([^/?]+)(\?|$)/);
  return match ? match[1] : "(unknown)";
};

const BATCH = 25;

const main = async (): Promise<void> => {
  const now = Math.floor(Date.now() / 1000);
  const total = await countTokensToCanonicalCheck(now);
  console.log(`Resolving canonical addresses for ${total} pair tokens in "${targetDb()}"…`);

  let checked = 0;
  let withAddress = 0;
  let impostorPairs = 0;

  for (;;) {
    const ids = await tokensToCanonicalCheck(now, BATCH);
    if (ids.length === 0) {
      break;
    }
    for (const id of ids) {
      const out = await runCanonicalCheckForToken(id, { now });
      if (out.checked) {
        checked += 1;
        if (out.hasAddress) {
          withAddress += 1;
        }
        impostorPairs += out.impostorPairs;
      }
    }
    console.log(`  …${checked}/${total} checked, ${withAddress} canonicals resolved, ${impostorPairs} impostor pairs flagged`);
  }

  console.log(`Done. ${checked} tokens checked, ${withAddress} canonical addresses resolved, ${impostorPairs} pairs routed to review (possible impostor).`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
