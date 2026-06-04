// Full verify-pipeline orchestrator. One command, end to end:
//   ingest → identity → canonical → factory → scam → revalidate
// so an iteration is a single line instead of seven. For a clean-slate run,
// dump first (the dump keeps its own "yes" confirmation):
//   yarn dump truncate-dex && yarn pipeline
//
// Set GECKO_API_KEY (free CoinGecko Demo key) in .env to speed the CoinGecko-
// bound passes (ingest + canonical). Each pass is idempotent + resumable, so a
// re-run picks up where it left off.

import {
  canonicalPass,
  factoryPass,
  identityPass,
  ingestAll,
  revalidatePass,
  scamPass,
  targetDb,
} from "../lib/pipeline";
import prisma from "../lib/prisma";

const log = (m: string): void => console.log(m);
const step = (n: number, title: string): void => console.log(`\n=== ${n}/6 · ${title} ===`);

const main = async (): Promise<void> => {
  console.log(`Running the full verify pipeline against "${targetDb()}"`);

  step(1, "INGEST");
  const ing = await ingestAll({ log });
  console.log(`→ ${ing.pairs} pairs ingested`);

  step(2, "IDENTITY CHECK");
  const id = await identityPass({ log });
  console.log(`→ ${id.confirmed} tokens confirmed · ${id.promoted} pairs promoted`);

  step(3, "CANONICAL CHECK");
  const can = await canonicalPass({ log });
  console.log(`→ ${can.resolved} canonicals resolved · ${can.impostorPairs} impostor pairs → review`);

  step(4, "FACTORY CHECK");
  const fac = await factoryPass({ log });
  console.log(`→ ${fac.read} factories read · ${fac.mismatches} mismatches → review`);

  step(5, "SCAM CHECK");
  const scam = await scamPass({ log });
  console.log(`→ ${scam.flagged} tokens flagged · ${scam.demoted} pairs demoted`);

  step(6, "REVALIDATE");
  const rev = await revalidatePass({ log });

  console.log(`\n✓ Pipeline complete (${rev.count} pairs). Final verdict distribution:`);
  for (const [verdict, count] of Object.entries(rev.tallies).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${verdict.padEnd(20)} ${count}`);
  }
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
