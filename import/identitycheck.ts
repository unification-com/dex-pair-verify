// Headless multi-source identity check (Phase 5, T1) — thin CLI over the shared
// identityPass (lib/pipeline.ts). Resolves identity for no-cgId pair tokens and
// promotes confirmed pairs out of Needs Review. Run after an ingest:
//   yarn identitycheck

import { identityPass, targetDb } from "../lib/pipeline";
import prisma from "../lib/prisma";

const main = async (): Promise<void> => {
  console.log(`Identity-checking no-cgId pair tokens in "${targetDb()}"…`);
  const s = await identityPass({ log: (m) => console.log(`  ${m}`) });
  console.log(`Done. ${s.total} tokens checked, ${s.confirmed} identity-confirmed, ${s.promoted} pairs promoted.`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
