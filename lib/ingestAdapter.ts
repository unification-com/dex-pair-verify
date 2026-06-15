// lib/ingestAdapter.ts
// The source-neutral ingest seam (#128 Phase 2). dpv's ingest was GeckoTerminal + EVM end-to-end;
// this lifts the transport + normalisation out of the orchestrator (lib/ingest.ts) behind an
// IngestAdapter so a non-EVM, non-GeckoTerminal source (Osmosis SQS, Numia, …) can feed the same
// verdict/trust/export pipeline. An adapter's job is: fetch a source page, NORMALISE it to the
// common pool/token shape the orchestrator already consumes, and corroborate the pools against the
// source's own pricing surface. The GeckoTerminal/EVM implementation is lib/gtAdapter.ts; a Cosmos
// adapter slots in beside it later (selected by chain kind), with no orchestrator change.
//
// Refactor-first: Phase 2a introduces this seam with ZERO behaviour change — the GeckoTerminal
// adapter produces exactly what the old inline GT code did, proven by the existing ingest tests.

// A token normalised from whatever source produced it. `address` is the identity key dpv stores +
// keys a pair's tokens by — an EVM contract address today (GeckoTerminal), an IBC denom for Cosmos.
// Every other field mirrors what the verdict + export consume, regardless of source.
export type NormalisedToken = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  coingeckoCoinId: string;
  priceUsd: number;
  marketCapUsd: number;
  totalSupply: number;
  volume24hUsd: number;
};

// A pool normalised from a source. `poolId` is the stored pool key (a 20-byte address or a 32-byte
// Uniswap-v4 poolId for EVM; a pool id/denom-pair for Cosmos). `baseAddress`/`quoteAddress` are the
// RESOLVED token identity keys — native currency already mapped to the wrapped token — and match the
// keys in the page's token map. `dexId` is the source's own dex id for the pool, used to route a
// multi-dex token-pools fetch to the right supported source.
export type NormalisedPool = {
  poolId: string;
  baseAddress: string;
  quoteAddress: string;
  dexId?: string;
  reserveUsd: number;
  volume24hUsd: number;
  marketCapUsd: number;
  priceChange24h: number;
  buys24h: number;
  sells24h: number;
  buyers24h: number;
  sellers24h: number;
  baseTokenPriceUsd: number;
  quoteTokenPriceUsd: number;
  poolCreatedAt: number | null;
};

// Per-page corroboration facts. EVM: presence in the source's pricing subgraph (drops
// GeckoTerminal-only phantom pools the oracle can't price) + the v4 hooks contract. A source with no
// corroboration surface (Cosmos SQS) returns idsAlign=false with empty maps — the orchestrator then
// makes NO claim (fail-open: subgraphPresent=null / hooks=null), leaving go-ooo's own price filters
// as the backstop.
export type PoolFacts = {
  // ≥1 of the queried pools was found, proving the source's pool-id format lines up with the
  // corroboration surface. Only then is a pool's ABSENCE trustworthy.
  idsAlign: boolean;
  present: Set<string>; // lower-cased pool ids the surface indexes
  hooks: Map<string, string>; // lower-cased poolId → hooks contract (univ4 only)
};

// A fully-normalised source page: the pools, their tokens (keyed by resolved address) and the
// corroboration facts. `poolCount` is the RAW count the transport returned (before any pool was
// dropped for an unresolvable id/token) — the orchestrator uses it to decide whether the page had
// data and should keep paginating, matching the pre-refactor semantics.
export type NormalisedPage = {
  poolCount: number;
  pools: NormalisedPool[];
  tokens: Map<string, NormalisedToken>;
  facts: PoolFacts;
};

// What the orchestrator hands an adapter to fetch one page. `gtNetwork`/`gtDex`/`poolFetcher` are
// transport hints an adapter reads only if it needs them (the GeckoTerminal adapter does — the slug
// pair, and an injectable fetcher the tests stub; a Cosmos adapter ignores them). `poolFetcher` is
// typed `unknown` here to keep this seam free of any GeckoTerminal shape; the adapter casts it to its
// own fetcher type.
export type PoolPageRequest = {
  now: number;
  gtNetwork?: string;
  gtDex?: string;
  poolFetcher?: unknown;
};

// A source behind the ingest pipeline. `kind` selects the identity path downstream (EVM:
// CoinGecko/factory; Cosmos: chain-registry asset-lists). `poolPage` transports + normalises +
// corroborates one page; `corroborate` is the same corroboration exposed for the per-pool
// token-pools / manual-add paths, which fetch their own pools.
export interface IngestAdapter {
  kind: "evm" | "cosmos";
  poolPage(chain: string, dex: string, page: number, req: PoolPageRequest): Promise<NormalisedPage>;
  corroborate(chain: string, dex: string, pools: NormalisedPool[]): Promise<PoolFacts>;
}

// An empty (no-claim) PoolFacts — the fail-open default when a source has no corroboration surface or
// a fetch fails. Shared by adapters (DRY).
export const emptyPoolFacts = (): PoolFacts => ({ idsAlign: false, present: new Set(), hooks: new Map() });
