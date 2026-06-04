// Headless GoPlus scam check (A.7) — thin CLI over the shared scamPass
// (lib/pipeline.ts). Flags scam tokens in verified pairs and demotes those pairs
// to Needs Review. Run after the promotion passes (identity / canonical):
//   yarn scancheck
// GoPlus free tier is 30/min — resumable + cached via scamCheckedAt.

import { scamPass, targetDb } from "../lib/pipeline";
import prisma from "../lib/prisma";

const main = async (): Promise<void> => {
  console.log(`Scam-checking verified-pair tokens in "${targetDb()}"…`);
  const s = await scamPass({ log: (m) => console.log(`  ${m}`) });
  console.log(`Done. ${s.total} tokens checked, ${s.flagged} flagged, ${s.demoted} pairs demoted to Needs Review.`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
