// Headless review-queue enrichment (B5) — thin CLI over the shared
// reviewEnrichPass (lib/pipeline.ts). Pre-runs the decision-support enrichers
// (GoPlus + Honeypot.is + Etherscan source-verified + web presence) over the
// tokens in NeedsReview pairs, so the review queue arrives pre-scanned. The
// per-token "Run security scan" button stays the on-demand fallback.
//
// Heavier API spend than the other passes (≈4 external calls per token,
// GoPlus-paced at 30/min) — DELIBERATELY not part of `yarn pipeline`. Resumable +
// cached via securityCheckedAt, so a stop/re-run continues where it left off:
//   yarn review-enrich

import "../lib/env";

import { reviewEnrichPass, targetDb } from "../lib/pipeline";
import prisma from "../lib/prisma";

const main = async (): Promise<void> => {
  console.log(`Pre-scanning NeedsReview-pair tokens in "${targetDb()}" (GoPlus-paced, resumable)…`);
  const s = await reviewEnrichPass({ log: (m) => console.log(`  ${m}`) });
  console.log(`Done. ${s.scanned}/${s.total} tokens enriched, ${s.flagged} scam-flagged.`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
