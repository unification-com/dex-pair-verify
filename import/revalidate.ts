// Headless re-validation: run the verdict engine across every pair using the
// current Threshold rows, printing a verdict tally. The CLI counterpart to the
// /admin/revalidate page — same shared engine (runVerdictForPair), no browser
// loop. Use after tuning thresholds at /admin/thresholds to re-adjudicate the
// whole set in one shot:
//   yarn revalidate
//
// Manual* pairs are never touched (rule R6, enforced inside runVerdictForPair).
// Idempotent: safe to run repeatedly.

import prisma from "../lib/prisma";
import { runVerdictForPair } from "../lib/verdictRunner";

const targetDb = (): string => {
  const url = process.env.POSTGRES_PRISMA_URL || "";
  const match = url.match(/\/([^/?]+)(\?|$)/);
  return match ? match[1] : "(unknown)";
};

const main = async (): Promise<void> => {
  console.log(`Re-validating all pairs in "${targetDb()}" against current thresholds…`);

  const pairs = await prisma.pair.findMany({ select: { id: true } });
  const tallies: Record<string, number> = {};

  let done = 0;
  for (const p of pairs) {
    const out = await runVerdictForPair(p.id);
    const key = out.skippedManual ? "skippedManual(R6)" : out.result?.verdict ?? "error";
    tallies[key] = (tallies[key] ?? 0) + 1;
    done += 1;
    if (done % 200 === 0) {
      console.log(`  …${done}/${pairs.length}`);
    }
  }

  console.log(`Done. Re-validated ${pairs.length} pairs:`);
  for (const [verdict, count] of Object.entries(tallies).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${verdict.padEnd(20)} ${count}`);
  }
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
