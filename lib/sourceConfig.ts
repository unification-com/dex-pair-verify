// lib/sourceConfig.ts
// Typed, DB-backed accessors over the SupportedSource registry (T6.5). The runtime
// source list now comes from the DB, so promoting a source via /admin/sources adds
// it to the pipeline with no code change (the point of T6.5). `getSources()`
// memoises the row load for the process; pass force=true (the promote endpoint
// does) to refresh after a write.
//
// Threshold cold-start floors still live in code (lib/baselineSources.ts) so a
// fresh/wiped DB re-seeds the original sources' tuned values; anything else falls
// back to the schema defaults. thresholdSeedData stays synchronous (code-only).

import { BASELINE_SOURCES } from "./baselineSources";
import { isCosmosRegistryChain } from "./cosmosRegistry";
import prisma from "./prisma";
import { applyUrlTemplate, keyEnvVarFor, SubgraphProvider } from "./subgraphVerify";

export type ThresholdDefaults = {
  minLiquidityUsd: number;
  hardMinLiquidityUsd: number;
  minTxCount?: number;
  minTurnoverRatio?: number;
};

export type SourceEntry = {
  chain: string;
  dex: string;
  canonicalFactoryAddress?: string;
  onCoinGeckoTerminal?: boolean;
  last_page?: number;
  gtNetwork?: string;
  gtDex?: string;
  // Subgraph fields — used by the price-test (getprices) + the export manifest, not
  // the GeckoTerminal verification pipeline. Templates carry the {API_KEY} placeholder.
  subgraphUrlTemplate?: string;
  subgraphSchemaFamily?: string;
  subgraphProvider?: string;
  apiKeyEnvVar?: string;
  // Transport (#128): "subgraph" (default) or "rest-sqs" (Cosmos SQS — subgraphUrlTemplate is the
  // SQS base URL).
  sourceType?: string;
};

// The GeckoTerminal network/dex slug for a source (defaults to our chain/dex id).
export const gtNetworkFor = (s: SourceEntry): string => s.gtNetwork ?? s.chain;
export const gtDexFor = (s: SourceEntry): string => s.gtDex ?? s.dex;

const toEntry = (r: {
  chain: string;
  dex: string;
  factoryAddress: string;
  onCoinGeckoTerminal: boolean;
  lastPage: number;
  gtNetwork: string | null;
  gtDex: string | null;
  subgraphUrlTemplate: string;
  subgraphSchemaFamily: string;
  subgraphProvider: string;
  apiKeyEnvVar: string | null;
  sourceType: string;
}): SourceEntry => ({
  chain: r.chain,
  dex: r.dex,
  canonicalFactoryAddress: r.factoryAddress,
  onCoinGeckoTerminal: r.onCoinGeckoTerminal,
  last_page: r.lastPage,
  gtNetwork: r.gtNetwork ?? undefined,
  gtDex: r.gtDex ?? undefined,
  subgraphUrlTemplate: r.subgraphUrlTemplate,
  subgraphSchemaFamily: r.subgraphSchemaFamily,
  subgraphProvider: r.subgraphProvider,
  apiKeyEnvVar: r.apiKeyEnvVar ?? undefined,
  sourceType: r.sourceType,
});

// Process-memoised load of the SupportedSource registry. The registry is small and
// rarely changes, so one load per process is fine; force=true refreshes it (call
// after promoting a source so a long-lived server picks it up).
let cache: Promise<SourceEntry[]> | null = null;

export function getSources(force = false): Promise<SourceEntry[]> {
  if (!cache || force) {
    cache = prisma.supportedSource
      .findMany({
        orderBy: [{ chain: "asc" }, { dex: "asc" }],
        select: {
          chain: true, dex: true, factoryAddress: true, onCoinGeckoTerminal: true, lastPage: true, gtNetwork: true, gtDex: true,
          subgraphUrlTemplate: true, subgraphSchemaFamily: true, subgraphProvider: true, apiKeyEnvVar: true, sourceType: true,
        },
      })
      .then((rows) => rows.map(toEntry));
  }
  return cache;
}

// Drop the memoised registry so the next getSources() reloads. The integration
// suite resets the DB between tests, so its cache must follow.
export function invalidateSourceCache(): void {
  cache = null;
}

export const getSource = async (chain: string, dex: string): Promise<SourceEntry | undefined> =>
  (await getSources()).find((s) => s.chain === chain && s.dex === dex);

// Whether a source has an ingest path. An EVM source ingests only when GeckoTerminal indexes it; a
// Cosmos source ingests via the SQS adapter regardless (GeckoTerminal does not index Cosmos). The
// single gate shared by the pipeline ingest loop and the admin ingest handler (#128).
export const isIngestableSource = (s: SourceEntry): boolean =>
  s.onCoinGeckoTerminal !== false || isCosmosRegistryChain(s.chain);

// Resolve a source's literal subgraph URL: substitute the operator's provider API key (from env)
// into the stored {API_KEY} template. The key is never persisted/returned — only used at call
// time. Returns null when the source has no subgraph configured. Shared by the price-test fetch
// and the v4 hooks capture (DRY).
export const resolveSubgraphUrl = (source: SourceEntry): string | null => {
  if (!source.subgraphUrlTemplate) {
    return null;
  }
  const keyEnvVar = source.apiKeyEnvVar || keyEnvVarFor(source.subgraphProvider as SubgraphProvider);
  const key = keyEnvVar ? process.env[keyEnvVar] ?? "" : "";
  return applyUrlTemplate(source.subgraphUrlTemplate, key);
};

// The canonical DEX factory for a (chain, dex), or null when unknown / not curated
// (empty string, e.g. qomswap) — the factory fence skips in that case.
export const getCanonicalFactoryAddress = async (chain: string, dex: string): Promise<string | null> => {
  const factory = (await getSource(chain, dex))?.canonicalFactoryAddress;
  return factory && factory.length > 0 ? factory : null;
};

// Cold-start Threshold-row data for a (chain, dex). Baseline sources' tuned floors
// live in lib/baselineSources.ts; anything else gets the schema defaults (the
// returned object simply omits the optional knobs). Synchronous — code-only.
const baselineDefaults = (chain: string, dex: string): ThresholdDefaults | undefined =>
  BASELINE_SOURCES.find((s) => s.chain === chain && s.dex === dex)?.defaultThresholds;

export const thresholdSeedData = (
  chain: string,
  dex: string,
): { chain: string; dex: string; minLiquidityUsd: number; minTxCount: number; hardMinLiquidityUsd?: number; minTurnoverRatio?: number } => {
  const d = baselineDefaults(chain, dex);
  return {
    chain,
    dex,
    minLiquidityUsd: d?.minLiquidityUsd ?? 0,
    minTxCount: d?.minTxCount ?? 0,
    ...(d ? { hardMinLiquidityUsd: d.hardMinLiquidityUsd } : {}),
    ...(d?.minTurnoverRatio !== undefined ? { minTurnoverRatio: d.minTurnoverRatio } : {}),
  };
};
