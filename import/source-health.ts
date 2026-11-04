// Price-feed health check for every live subgraph and Cosmos source: a thin CLI
// over checkSourceHealth (lib/sourceHealth.ts). Sources that keep failing are paused
// (left out of the go-ooo manifest and the priceable flag) until they recover.
// Run from cron every few hours:
//   yarn source-health

import "../lib/env";

import { targetDb } from "../lib/pipeline";
import prisma from "../lib/prisma";
import { checkSourceHealth } from "../lib/sourceHealth";

const main = async (): Promise<void> => {
  console.log(`=== source health ${new Date().toISOString()} on "${targetDb()}" ===`);
  const s = await checkSourceHealth({ log: (m) => console.log(`  ${m}`) });
  const failing = s.failing.length ? `failing: ${s.failing.join(", ")}` : "all passing";
  const paused = s.paused.length ? ` · paused: ${s.paused.join(", ")}` : "";
  console.log(`Done. ${s.checked} checked · ${failing}${paused}${s.recorded ? "" : " · NOT recorded (looked systemic)"}`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
