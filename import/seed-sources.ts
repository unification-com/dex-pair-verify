// import/seed-sources.ts
// Phase 4, T6.5 — migrate the current lib/sources.js registry into the
// SupportedSource table (+ seed each one's Threshold row), giving exact parity
// with what drives the pipeline today. Idempotent (upsert on chain_dex). Run with:
//   yarn seed-sources
//
// This is the migration step: it reads the live lib/sources.js (the current truth)
// and templates each subgraph URL ({API_KEY} placeholder — the literal key is
// never persisted) so the registry can move to the DB. NEW 4.D targets are NOT
// seeded here — they're onboarded via /admin/sources once their chain plumbing
// (lib/chains.ts RPC/CG platform) lands. After sourceConfig reads SupportedSource
// (next step), lib/sources.js is deleted.

import "../lib/env";

import prisma from "../lib/prisma";
import { thresholdSeedData } from "../lib/sourceConfig";
import { dataSources } from "../lib/sources";
import { detectProvider, SchemaFamily, toUrlTemplate } from "../lib/subgraphVerify";

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

// The graphql sub-shape we read off each raw lib/sources.js entry.
type RawSource = {
  chain: string;
  dex: string;
  gtNetwork?: string;
  gtDex?: string;
  canonicalFactoryAddress?: string;
  onCoinGeckoTerminal?: boolean;
  last_page?: number;
  graphql: { poolsName: string; url: string };
};

// univ2 exposes a `pairs` collection, univ3 a `pools` one; anything else is custom.
const familyFromPoolsName = (poolsName: string): SchemaFamily =>
  poolsName === "pairs" ? "univ2" : poolsName === "pools" ? "univ3" : "custom";

const main = async (): Promise<void> => {
  const sources = dataSources as unknown as RawSource[];
  const now = nowSeconds();
  console.log(`Migrating ${sources.length} lib/sources.js source(s) into SupportedSource…\n`);

  for (const s of sources) {
    // toUrlTemplate rewrites the decentralised-gateway key segment to {API_KEY};
    // self-hosted / hosted URLs (qomswap) pass through unchanged.
    const { template } = toUrlTemplate(s.graphql.url);
    const provider = detectProvider(s.graphql.url);
    const data = {
      subgraphUrlTemplate: template,
      subgraphSchemaFamily: familyFromPoolsName(s.graphql.poolsName),
      subgraphProvider: provider,
      factoryAddress: s.canonicalFactoryAddress ?? "",
      gtNetwork: s.gtNetwork ?? null,
      gtDex: s.gtDex ?? null,
      onCoinGeckoTerminal: s.onCoinGeckoTerminal ?? true,
      lastPage: s.last_page ?? 10,
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

    console.log(`  ✓ ${s.chain}/${s.dex}  (${data.subgraphProvider} · ${data.subgraphSchemaFamily}${data.onCoinGeckoTerminal ? "" : " · not-on-GT"})`);
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
