// Full verify-pipeline orchestrator. One command, end to end:
//   ingest → identity → canonical → factory → scam → revalidate → review-enrich
// so an iteration is a single line instead of seven. For a clean-slate run, dump
// first (the dump keeps its own "yes" confirmation):
//   yarn dump truncate-dex && yarn pipeline
//
// The final REVIEW-ENRICH step pre-scans the NeedsReview queue's tokens (GoPlus +
// Honeypot.is + source-verified + web presence) so the queue arrives pre-scanned.
// It's the heaviest step (≈4 external calls/token, GoPlus-paced) — pass
// `--no-enrich` to skip it for a quick iteration:
//   yarn pipeline --no-enrich
//
// Set GECKO_API_KEY (free CoinGecko Demo key) in .env to speed the CoinGecko-
// bound passes (ingest + canonical). Each pass is idempotent + resumable, so a
// re-run picks up where it left off.

import "../lib/env";

import {
  canonicalPass,
  factoryPass,
  identityPass,
  ingestAll,
  reviewEnrichPass,
  revalidatePass,
  scamPass,
  targetDb,
} from "../lib/pipeline";
import prisma from "../lib/prisma";

const log = (m: string): void => console.log(m);
const enrich = !process.argv.includes("--no-enrich");
const total = enrich ? 7 : 6;
const step = (n: number, title: string): void => console.log(`\n=== ${n}/${total} · ${title} ===`);

const main = async (): Promise<void> => {
  console.log(`Running the full verify pipeline against "${targetDb()}"${enrich ? "" : " (--no-enrich: skipping review-enrich)"}`);

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
  console.log(`→ ${rev.count} pairs re-verified`);

  // After revalidate so it scans the final NeedsReview set; it may flag a honeypot
  // GoPlus missed and demote that token's pairs (verdict re-run inside the scan).
  if (enrich) {
    step(7, "REVIEW-ENRICH");
    const enr = await reviewEnrichPass({ log });
    console.log(`→ ${enr.scanned}/${enr.total} NeedsReview tokens enriched · ${enr.flagged} scam-flagged`);
  }

  // Final verdict distribution, re-queried so it reflects any review-enrich demotions.
  const dist = await prisma.pair.groupBy({ by: ["status"], _count: { _all: true } });
  console.log(`\n✓ Pipeline complete. Final verdict distribution:`);
  for (const row of dist.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${String(row.status).padEnd(20)} ${row._count._all}`);
  }
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
