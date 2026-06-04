// Headless GeckoTerminal ingest — thin CLI over ingestAll (lib/pipeline.ts).
// Pulls pairs for every configured source and runs the verdict inline. Set
// GECKO_API_KEY (free CoinGecko Demo key) for the keyed, faster endpoint.
//   yarn ingest

import "../lib/env";

import { ingestAll, targetDb } from "../lib/pipeline";
import prisma from "../lib/prisma";

const main = async (): Promise<void> => {
  console.log(`Ingesting from GeckoTerminal into "${targetDb()}"…`);
  const s = await ingestAll({ log: (m) => console.log(`  ${m}`) });
  console.log(`Done. ${s.pairs} pairs ingested. Verdicts: ${JSON.stringify(s.tallies)}`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
