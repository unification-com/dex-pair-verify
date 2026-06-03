// Headless multi-source identity check (Phase 5, T1). Resolves token identity
// for every no-CoinGecko-id pair token (token lists + GoPlus), persists the
// result, and re-runs the verdict so newly-identified pairs leave NeedsReview.
// The CLI counterpart to the (later) /admin/identitycheck page — same shared
// engine (runIdentityCheckForToken). Run after an ingest, before/with revalidate:
//   yarn identitycheck
//
// Network calls (token-list fetches once + GoPlus per token) self-throttle via
// the shared 65s back-off, so a first run over many tokens can take a while; it's
// resumable + cached (identityCheckedAt), so subsequent runs are fast.

import { countTokensToIdentityCheck, runIdentityCheckForToken, tokensToIdentityCheck } from "../lib/identityCheck";
import prisma from "../lib/prisma";

const targetDb = (): string => {
  const url = process.env.POSTGRES_PRISMA_URL || "";
  const match = url.match(/\/([^/?]+)(\?|$)/);
  return match ? match[1] : "(unknown)";
};

const BATCH = 25;

const main = async (): Promise<void> => {
  const now = Math.floor(Date.now() / 1000);
  const total = await countTokensToIdentityCheck(now);
  console.log(`Identity-checking ${total} no-cgId pair tokens in "${targetDb()}"…`);

  let checked = 0;
  let confirmed = 0;
  let promotedPairs = 0;

  // jobStartedAt = now: each token's identityCheckedAt is stamped >= now once
  // done, so it drops out of the next batch query — resumable, no double-work.
  for (;;) {
    const ids = await tokensToIdentityCheck(now, BATCH);
    if (ids.length === 0) {
      break;
    }
    for (const id of ids) {
      const out = await runIdentityCheckForToken(id, { now });
      if (out.checked) {
        checked += 1;
        if (out.confirmed) {
          confirmed += 1;
        }
        promotedPairs += out.promotedPairs;
      }
    }
    console.log(`  …${checked}/${total} checked, ${confirmed} confirmed, ${promotedPairs} pairs promoted`);
  }

  console.log(`Done. ${checked} tokens checked, ${confirmed} identity-confirmed, ${promotedPairs} pairs promoted to verified.`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
