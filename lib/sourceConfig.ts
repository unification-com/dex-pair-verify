// Typed accessors over the lib/sources.js data-source config. Keeps the
// `dataSources` shape (untyped JS) behind a small typed surface so callers
// (the verdict runner, the A.4.1 ingest) don't reach into `any[]`.

import { dataSources } from "./sources";

export type SourceEntry = {
  chain: string;
  dex: string;
  canonicalFactoryAddress?: string;
};

const sources = dataSources as SourceEntry[];

export const getSource = (chain: string, dex: string): SourceEntry | undefined =>
  sources.find((s) => s.chain === chain && s.dex === dex);

// The canonical DEX factory address for a (chain, dex), or null when the source
// is unknown or its factory hasn't been curated yet (e.g. qomswap_v2).
export const getCanonicalFactoryAddress = (chain: string, dex: string): string | null => {
  const factory = getSource(chain, dex)?.canonicalFactoryAddress;
  return factory && factory.length > 0 ? factory : null;
};
