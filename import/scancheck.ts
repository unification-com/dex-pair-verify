// Headless GoPlus scam check (A.7). The CLI counterpart to /admin/scancheck —
// same shared engine (runScamCheckForToken). Checks the tokens in verified pairs,
// flags scams (honeypot, extreme tax, hidden owner…) and demotes any AutoVerified
// pair using a flagged token to NeedsReview (never auto-rejected — operator
// decides). Run after the promotion passes (identity / canonical):
//   yarn scancheck
//
// GoPlus free tier is 30/min — resumable + cached via scamCheckedAt.

import prisma from "../lib/prisma";
import { countTokensToScamCheck, runScamCheckForToken, tokensToScamCheck } from "../lib/scamCheck";

const targetDb = (): string => {
  const url = process.env.POSTGRES_PRISMA_URL || "";
  const match = url.match(/\/([^/?]+)(\?|$)/);
  return match ? match[1] : "(unknown)";
};

const BATCH = 25;

const main = async (): Promise<void> => {
  const now = Math.floor(Date.now() / 1000);
  const total = await countTokensToScamCheck(now);
  console.log(`Scam-checking ${total} verified-pair tokens in "${targetDb()}"…`);

  let checked = 0;
  let flagged = 0;
  let demotedPairs = 0;

  for (;;) {
    const ids = await tokensToScamCheck(now, BATCH);
    if (ids.length === 0) {
      break;
    }
    for (const id of ids) {
      const out = await runScamCheckForToken(id);
      if (out.checked) {
        checked += 1;
        if (out.flagged) {
          flagged += 1;
        }
        demotedPairs += out.demotedPairs;
      }
    }
    console.log(`  …${checked}/${total} checked, ${flagged} flagged, ${demotedPairs} pairs demoted`);
  }

  console.log(`Done. ${checked} tokens checked, ${flagged} flagged, ${demotedPairs} pairs demoted to Needs Review.`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
