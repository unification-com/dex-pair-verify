// lib/baselineSources.ts
// The original production source registry, in code — the bootstrap that
// `yarn seed-sources` writes into the SupportedSource table (Phase 4, T6.5).
//
// At runtime the pipeline reads the *DB* (so promoting a source via /admin/sources
// adds it without a code change — the point of T6.5). This file is the recovery
// seed: wipe the DB and re-run `yarn seed-sources` and the original sources come
// back from here. Operator-promoted sources live only in the DB (like pair
// statuses / thresholds) and need a re-promote or DB restore after a wipe.
//
// Lifted from the retired lib/sources.js. The subgraph *query* functions that file
// carried are gone — the verification pipeline is GeckoTerminal-only, and price
// queries (getprices / go-ooo) are generated from the schema family. URLs carry
// the {API_KEY} placeholder; the literal key is never stored.

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

const GATEWAY = "https://gateway-arbitrum.network.thegraph.com/api/{API_KEY}/subgraphs/id/";
const dec = (id: string): string => `${GATEWAY}${id}`;

export const BASELINE_SOURCES: BaselineSource[] = [
  { chain: "eth", dex: "uniswap_v2", subgraphUrlTemplate: dec("EYCKATKGBKLWvSfwvBjzfCBmGwYNdVkduYXVivCsLRFu"), subgraphProvider: "graph-decentralized", schemaFamily: "univ2", factoryAddress: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", onCoinGeckoTerminal: true, lastPage: 10, defaultThresholds: { minLiquidityUsd: 25000, hardMinLiquidityUsd: 5000, minTxCount: 5 } },
  { chain: "eth", dex: "uniswap_v3", subgraphUrlTemplate: dec("5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV"), subgraphProvider: "graph-decentralized", schemaFamily: "univ3", factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984", onCoinGeckoTerminal: true, lastPage: 10, defaultThresholds: { minLiquidityUsd: 30000, hardMinLiquidityUsd: 5000, minTxCount: 5 } },
  { chain: "eth", dex: "sushiswap", subgraphUrlTemplate: dec("6NUtT5mGjZ1tSshKLf5Q3uEEJtjBZJo1TpL5MXsUBqrT"), subgraphProvider: "graph-decentralized", schemaFamily: "univ2", factoryAddress: "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac", onCoinGeckoTerminal: true, lastPage: 10, defaultThresholds: { minLiquidityUsd: 10000, hardMinLiquidityUsd: 2000, minTxCount: 3 } },
  { chain: "eth", dex: "shibaswap", subgraphUrlTemplate: dec("61LXXvGA1KXkJZbCceYqw9APcwTGefK5MytwnVsdAQpw"), subgraphProvider: "graph-decentralized", schemaFamily: "univ2", factoryAddress: "0x115934131916C8b277DD010Ee02de363c09d037c", onCoinGeckoTerminal: true, lastPage: 10, defaultThresholds: { minLiquidityUsd: 5000, hardMinLiquidityUsd: 2000, minTxCount: 1 } },
  { chain: "polygon_pos", dex: "quickswap_v3", subgraphUrlTemplate: dec("FqsRcH1XqSjqVx9GRTvEJe959aCbKrcyGgDWBrUkG24g"), subgraphProvider: "graph-decentralized", schemaFamily: "univ3", factoryAddress: "0x411b0fAcC3489691f28ad58c47006AF5E3Ab3A28", onCoinGeckoTerminal: true, lastPage: 10, defaultThresholds: { minLiquidityUsd: 5000, hardMinLiquidityUsd: 2000, minTxCount: 1 } },
  { chain: "xdai", dex: "honeyswap", subgraphUrlTemplate: dec("HTxWvPGcZ5oqWLYEVtWnVJDfnai2Ud1WaABiAR72JaSJ"), subgraphProvider: "graph-decentralized", schemaFamily: "univ2", factoryAddress: "0xA818b4F111Ccac7AA31D0BCc0806d64F2E0737D7", onCoinGeckoTerminal: true, lastPage: 10, defaultThresholds: { minLiquidityUsd: 5000, hardMinLiquidityUsd: 2000, minTxCount: 1 } },
  { chain: "bsc", dex: "bsc_pancakeswap_v3", gtDex: "pancakeswap-v3-bsc", subgraphUrlTemplate: dec("A1fvJWQLBeUAggX2WQTMm3FKjXTekNXo77ZySun4YN2m"), subgraphProvider: "graph-decentralized", schemaFamily: "univ3", factoryAddress: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865", onCoinGeckoTerminal: true, lastPage: 10, defaultThresholds: { minLiquidityUsd: 35000, hardMinLiquidityUsd: 5000, minTxCount: 5 } },
  // QoM parked: self-hosted subgraph, not on GeckoTerminal, factory not yet curated.
  { chain: "qom", dex: "qomswap_v2", subgraphUrlTemplate: "https://subgraph.qomswap.com/subgraphs/name/test/exchange", subgraphProvider: "self-hosted", schemaFamily: "univ2", factoryAddress: "", onCoinGeckoTerminal: false, lastPage: 10 },
];
