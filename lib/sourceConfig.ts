// Typed accessors over the lib/sources.js data-source config. Keeps the
// `dataSources` shape (untyped JS) behind a small typed surface so callers
// (the verdict runner, the A.4.1 ingest) don't reach into `any[]`.

import { dataSources } from "./sources";

export type SourceEntry = {
  chain: string;
  dex: string;
  canonicalFactoryAddress?: string;
  onCoinGeckoTerminal?: boolean;
  last_page?: number;
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
