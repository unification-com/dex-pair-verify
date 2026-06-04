// Re-score scam flags from CACHED GoPlus data — thin CLI over rescoreScamPass
// (lib/pipeline.ts). Apply a change to evaluateScamSignals (lib/scamCheck.ts) to
// every already-checked token WITHOUT re-fetching GoPlus: re-evaluates the
// stored goPlusData against the current rule, flips any flag that changed, and
// re-runs the verdict for the affected pairs. Instant + quota-free — use this
// after tuning the scam signals, in preference to a full `yarn scancheck`
// (which re-fetches GoPlus for the whole verified set).
//   yarn rescore-scam
import "../lib/env";

import { rescoreScamPass, targetDb } from "../lib/pipeline";
import prisma from "../lib/prisma";

const main = async (): Promise<void> => {
  console.log(`Re-scoring cached GoPlus data against the current scam rule in "${targetDb()}" (no GoPlus calls)…`);
  const s = await rescoreScamPass({ log: (m) => console.log(`  ${m}`) });
  console.log(
    `Done. ${s.total} checked tokens re-scored · ${s.changed} flags changed ` +
      `(${s.nowFlagged} newly flagged, ${s.cleared} cleared).`,
  );
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
