// lib/baselineSources.ts
// The code-managed source registry — the bootstrap that `yarn seed-sources` writes
// into the SupportedSource table (Phase 4, T6.5). Two parts:
//   - ORIGINAL_SOURCES: the original production GT-backed sources.
//   - adoptedSources: 4.D expansion sources we've adopted, DERIVED from the
//     validated catalogue (lib/sourceSeeds.ts) so their subgraph IDs / factories
//     are defined once (DRY) — here we only say WHICH to adopt + add registry
//     fields (thresholds / pagination).
//
// At runtime the pipeline reads the DB (so promoting a source via /admin/sources
// adds it with no code change — the point of T6.5). This file is the recovery
// seed: wipe the DB and re-run `yarn seed-sources` and these come back from code.
// Operator-promoted-via-UI sources live only in the DB (like pair statuses) and
// need a re-promote / DB restore after a wipe.
//
// URLs carry the {API_KEY} placeholder; the literal key is never stored.

import { decentralizedTemplate, SOURCE_SEEDS } from "./sourceSeeds";

import type { ThresholdDefaults } from "./sourceConfig";
import type { SchemaFamily, SubgraphProvider } from "./subgraphVerify";

export type BaselineSource = {
  chain: string;
  dex: string;
  gtNetwork?: string; // GeckoTerminal slugs — only when they differ from chain/dex
  gtDex?: string;
  subgraphUrlTemplate: string; // {API_KEY} placeholder
  subgraphProvider: SubgraphProvider;
  schemaFamily: SchemaFamily;
  factoryAddress: string; // "" = not curated (factory fence skips)
  onCoinGeckoTerminal: boolean; // false = skip GT ingest (self-hosted only)
  lastPage: number; // GT ingest pagination cap
  defaultThresholds?: ThresholdDefaults; // cold-start floors for the Threshold row
};

const ORIGINAL_SOURCES: BaselineSource[] = [
  { chain: "eth", dex: "uniswap_v2", subgraphUrlTemplate: decentralizedTemplate("EYCKATKGBKLWvSfwvBjzfCBmGwYNdVkduYXVivCsLRFu"), subgraphProvider: "graph-decentralized", schemaFamily: "univ2", factoryAddress: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", onCoinGeckoTerminal: true, lastPage: 10, defaultThresholds: { minLiquidityUsd: 25000, hardMinLiquidityUsd: 5000, minTxCount: 5 } },
  { chain: "eth", dex: "uniswap_v3", subgraphUrlTemplate: decentralizedTemplate("5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV"), subgraphProvider: "graph-decentralized", schemaFamily: "univ3", factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984", onCoinGeckoTerminal: true, lastPage: 10, defaultThresholds: { minLiquidityUsd: 30000, hardMinLiquidityUsd: 5000, minTxCount: 5 } },
  { chain: "eth", dex: "sushiswap", subgraphUrlTemplate: decentralizedTemplate("6NUtT5mGjZ1tSshKLf5Q3uEEJtjBZJo1TpL5MXsUBqrT"), subgraphProvider: "graph-decentralized", schemaFamily: "univ2", factoryAddress: "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac", onCoinGeckoTerminal: true, lastPage: 10, defaultThresholds: { minLiquidityUsd: 10000, hardMinLiquidityUsd: 2000, minTxCount: 3 } },
  { chain: "eth", dex: "shibaswap", subgraphUrlTemplate: decentralizedTemplate("61LXXvGA1KXkJZbCceYqw9APcwTGefK5MytwnVsdAQpw"), subgraphProvider: "graph-decentralized", schemaFamily: "univ2", factoryAddress: "0x115934131916C8b277DD010Ee02de363c09d037c", onCoinGeckoTerminal: true, lastPage: 10, defaultThresholds: { minLiquidityUsd: 5000, hardMinLiquidityUsd: 2000, minTxCount: 1 } },
  { chain: "polygon_pos", dex: "quickswap_v3", subgraphUrlTemplate: decentralizedTemplate("FqsRcH1XqSjqVx9GRTvEJe959aCbKrcyGgDWBrUkG24g"), subgraphProvider: "graph-decentralized", schemaFamily: "univ3", factoryAddress: "0x411b0fAcC3489691f28ad58c47006AF5E3Ab3A28", onCoinGeckoTerminal: true, lastPage: 10, defaultThresholds: { minLiquidityUsd: 5000, hardMinLiquidityUsd: 2000, minTxCount: 1 } },
  { chain: "xdai", dex: "honeyswap", subgraphUrlTemplate: decentralizedTemplate("HTxWvPGcZ5oqWLYEVtWnVJDfnai2Ud1WaABiAR72JaSJ"), subgraphProvider: "graph-decentralized", schemaFamily: "univ2", factoryAddress: "0xA818b4F111Ccac7AA31D0BCc0806d64F2E0737D7", onCoinGeckoTerminal: true, lastPage: 10, defaultThresholds: { minLiquidityUsd: 5000, hardMinLiquidityUsd: 2000, minTxCount: 1 } },
  { chain: "bsc", dex: "bsc_pancakeswap_v3", gtDex: "pancakeswap-v3-bsc", subgraphUrlTemplate: decentralizedTemplate("A1fvJWQLBeUAggX2WQTMm3FKjXTekNXo77ZySun4YN2m"), subgraphProvider: "graph-decentralized", schemaFamily: "univ3", factoryAddress: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865", onCoinGeckoTerminal: true, lastPage: 10, defaultThresholds: { minLiquidityUsd: 35000, hardMinLiquidityUsd: 5000, minTxCount: 5 } },
];

// 4.D expansion sources adopted 2026-06-05 — all decentralised-network univ2/univ3,
// validated live via `yarn validate-seeds`. Listed by GeckoTerminal slug; their
// subgraph IDs + factories come from lib/sourceSeeds.ts (single source of truth).
const ADOPTED_GT_KEYS = new Set([
  "polygon_pos/uniswap_v3_polygon_pos",
  "bsc/uniswap-bsc",
  "bsc/pancakeswap_v2",
  "arbitrum/uniswap_v3_arbitrum",
  "arbitrum/camelot",
  "arbitrum/camelot-v3",
  "base/uniswap-v3-base",
  "base/sushiswap-v2-base",
  "base/aerodrome-slipstream",
  "optimism/uniswap_v3_optimism",
]);

// Conservative cold-start floors for a newly-adopted source (no data yet) —
// operator-tunable per (chain,dex) at /admin/thresholds after the first ingest.
const ADOPTED_DEFAULT_THRESHOLDS: ThresholdDefaults = { minLiquidityUsd: 10000, hardMinLiquidityUsd: 2000, minTxCount: 3 };

const adoptedSources: BaselineSource[] = SOURCE_SEEDS.filter((s) =>
  ADOPTED_GT_KEYS.has(`${s.gtNetwork}/${s.gtDex}`),
).map((s) => ({
  chain: s.chain,
  dex: s.dex,
  gtNetwork: s.gtNetwork !== s.chain ? s.gtNetwork : undefined,
  gtDex: s.gtDex !== s.dex ? s.gtDex : undefined,
  subgraphUrlTemplate: decentralizedTemplate(s.subgraphId),
  subgraphProvider: "graph-decentralized" as SubgraphProvider,
  schemaFamily: s.schemaFamily,
  factoryAddress: s.factoryAddress,
  onCoinGeckoTerminal: true,
  lastPage: 10,
  defaultThresholds: ADOPTED_DEFAULT_THRESHOLDS,
}));

export const BASELINE_SOURCES: BaselineSource[] = [...ORIGINAL_SOURCES, ...adoptedSources];
