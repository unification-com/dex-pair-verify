// Typed accessors over the lib/sources.js data-source config. Keeps the
// `dataSources` shape (untyped JS) behind a small typed surface so callers
// (the verdict runner, the A.4.1 ingest) don't reach into `any[]`.

import { dataSources } from "./sources";

// Per-source cold-start floors for the verdict engine, seeded into a fresh
// Threshold row (A.8). minLiquidityUsd is the soft gate; hardMinLiquidityUsd
// the auto-reject floor. Operator-tunable per (chain, dex) thereafter.
export type ThresholdDefaults = { minLiquidityUsd: number; hardMinLiquidityUsd: number };

export type SourceEntry = {
  chain: string;
  dex: string;
  canonicalFactoryAddress?: string;
  onCoinGeckoTerminal?: boolean;
  last_page?: number;
  defaultThresholds?: ThresholdDefaults;
  // GeckoTerminal slugs — only needed when they differ from our internal
  // chain/dex ids (e.g. dex `bsc_pancakeswap_v3` → GT `pancakeswap-v3-bsc`).
  // Verified against GT's /networks + /networks/{n}/dexes via `yarn verify-gt`.
  gtNetwork?: string;
  gtDex?: string;
};

// The GeckoTerminal network slug for a source (defaults to our chain id).
export const gtNetworkFor = (s: SourceEntry): string => s.gtNetwork ?? s.chain;
// The GeckoTerminal dex slug for a source (defaults to our dex id).
export const gtDexFor = (s: SourceEntry): string => s.gtDex ?? s.dex;

const sources = dataSources as SourceEntry[];

export const sourceCount = sources.length;

export const getSourceByIndex = (i: number): SourceEntry | undefined => sources[i];

export const getSource = (chain: string, dex: string): SourceEntry | undefined =>
  sources.find((s) => s.chain === chain && s.dex === dex);

// The canonical DEX factory address for a (chain, dex), or null when the source
// is unknown or its factory hasn't been curated yet (e.g. qomswap_v2).
export const getCanonicalFactoryAddress = (chain: string, dex: string): string | null => {
  const factory = getSource(chain, dex)?.canonicalFactoryAddress;
  return factory && factory.length > 0 ? factory : null;
};

// The `data` for a freshly-seeded Threshold row, applying this source's A.8
// matrix floors where defined and otherwise leaving the schema defaults
// (hardMinLiquidityUsd 500 etc.) to apply. Single source of truth shared by
// every Threshold-row create site (DRY).
export const thresholdSeedData = (
  chain: string,
  dex: string,
): { chain: string; dex: string; minLiquidityUsd: number; minTxCount: number; hardMinLiquidityUsd?: number } => {
  const d = getSource(chain, dex)?.defaultThresholds;
  return {
    chain,
    dex,
    minLiquidityUsd: d?.minLiquidityUsd ?? 0,
    minTxCount: 0,
    ...(d ? { hardMinLiquidityUsd: d.hardMinLiquidityUsd } : {}),
  };
};
