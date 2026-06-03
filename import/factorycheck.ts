// Headless on-chain factory check (Phase 5, T2). Reads each pool's factory() via
// RPC for pairs not yet checked, persists it, and re-runs the verdict (a match
// raises confidence; a mismatch routes the pair to Needs Review). The CLI
// counterpart to /admin/factorycheck — same shared engine. Run after an ingest:
//   yarn factorycheck
//
// Factory is immutable per pool, so this is a one-time cost per pair; resumable
// + cached via factoryCheckedAt. A transient RPC miss leaves the pair unread (it
// re-runs next time).

import { countPairsToFactoryCheck, pairsToFactoryCheck, runFactoryCheckForPair } from "../lib/factoryCheck";
import prisma from "../lib/prisma";

const targetDb = (): string => {
  const url = process.env.POSTGRES_PRISMA_URL || "";
  const match = url.match(/\/([^/?]+)(\?|$)/);
  return match ? match[1] : "(unknown)";
};

const BATCH = 20;
const BATCH_DELAY_MS = 1000; // be polite to public RPCs
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const main = async (): Promise<void> => {
  const now = Math.floor(Date.now() / 1000);
  const total = await countPairsToFactoryCheck(now);
  console.log(`Factory-checking ${total} pairs in "${targetDb()}"…`);

  let checked = 0;
  let found = 0;
  let mismatches = 0;

  for (;;) {
    const ids = await pairsToFactoryCheck(now, BATCH);
    if (ids.length === 0) {
      break;
    }
    for (const id of ids) {
      const out = await runFactoryCheckForPair(id, { now });
      if (out.checked) {
        checked += 1;
        if (out.factoryFound) {
          found += 1;
        }
        if (out.mismatch) {
          mismatches += 1;
        }
      }
    }
    console.log(`  …${checked}/${total} checked, ${found} factories read, ${mismatches} mismatches`);
    await sleep(BATCH_DELAY_MS);
  }

  console.log(`Done. ${checked} pairs checked, ${found} factories read, ${mismatches} routed to review (factory mismatch).`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
