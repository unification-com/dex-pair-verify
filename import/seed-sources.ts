// import/seed-sources.ts
// Phase 4, T6.5 — seed/restore the SupportedSource table from the code bootstrap
// (lib/baselineSources.ts) + each source's Threshold row. Idempotent (upsert on
// chain_dex). Run with:
//   yarn seed-sources
//
// This is the recovery path: wipe the DB and re-run this to get the original
// production sources back from code. The runtime pipeline reads the DB, so
// operator-promoted sources (added via /admin/sources) live only in the DB and are
// not re-created here — restore those from a DB backup or re-promote.

import "../lib/env";

import { BASELINE_SOURCES } from "../lib/baselineSources";
import prisma from "../lib/prisma";
import { thresholdSeedData } from "../lib/sourceConfig";

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const main = async (): Promise<void> => {
  const now = nowSeconds();
  console.log(`Seeding ${BASELINE_SOURCES.length} baseline source(s) into SupportedSource…\n`);

  for (const s of BASELINE_SOURCES) {
    const data = {
      subgraphUrlTemplate: s.subgraphUrlTemplate,
      subgraphSchemaFamily: s.schemaFamily,
      sourceType: s.sourceType ?? "subgraph",
      subgraphProvider: s.subgraphProvider,
      factoryAddress: s.factoryAddress,
      gtNetwork: s.gtNetwork ?? null,
      gtDex: s.gtDex ?? null,
      onCoinGeckoTerminal: s.onCoinGeckoTerminal,
      lastPage: s.lastPage,
      lastVerifiedAt: now,
    };

    await prisma.supportedSource.upsert({
      where: { chain_dex: { chain: s.chain, dex: s.dex } },
      create: { chain: s.chain, dex: s.dex, enabledAt: now, ...data },
      update: data,
    });

    // Seed the per-(chain,dex) Threshold row with this source's tuned cold-start
    // floors (idempotent — only created if absent).
    if (!(await prisma.threshold.findFirst({ where: { chain: s.chain, dex: s.dex } }))) {
      await prisma.threshold.create({ data: thresholdSeedData(s.chain, s.dex) });
    }

    console.log(`  ✓ ${s.chain}/${s.dex}  (${s.subgraphProvider} · ${s.schemaFamily}${s.onCoinGeckoTerminal ? "" : " · not-on-GT"})`);
  }

  const count = await prisma.supportedSource.count();
  console.log(`\nDone. SupportedSource now holds ${count} row(s).`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
