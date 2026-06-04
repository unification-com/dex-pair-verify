// Headless re-validation — thin CLI over the shared revalidatePass
// (lib/pipeline.ts). Re-runs the verdict across every pair against the current
// thresholds; use after tuning thresholds at /admin/thresholds:
//   yarn revalidate
// R6-safe (Manual* pairs untouched). Idempotent.

import "../lib/env";

import { revalidatePass, targetDb } from "../lib/pipeline";
import prisma from "../lib/prisma";

const main = async (): Promise<void> => {
  console.log(`Re-validating all pairs in "${targetDb()}" against current thresholds…`);
  const s = await revalidatePass({ log: (m) => console.log(`  ${m}`) });
  console.log(`Done. Re-validated ${s.count} pairs:`);
  for (const [verdict, count] of Object.entries(s.tallies).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${verdict.padEnd(20)} ${count}`);
  }
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
