// lib/sqs.ts
// Minimal client for the Osmosis Sidecar Query Server (SQS) public REST API (sqs.osmosis.zone) — the
// Cosmos analogue of the EVM subgraph / GeckoTerminal transport dpv uses for discovery. It returns
// the live pool set (USD liquidity via `liquidity_cap`, 24h volume, the asset denoms + amounts, the
// pool id) and batch spot prices (each token quoted in a USD denom), so the Cosmos ingest adapter
// (lib/sqsAdapter.ts) can discover and value Osmosis pools without a subgraph. Pure HTTP/JSON, with
// the transports injectable so the adapter's tests run without a network call. Mirrors go-ooo's Go
// SQS client (ooo_api/dex/sqs) on the TypeScript side.

export const DEFAULT_SQS_URL = "https://sqs.osmosis.zone";

// The slice of an SQS pool we consume (the endpoint returns much more per pool).
export type SqsPool = {
  type: number;
  liquidity_cap: string; // USD liquidity, a decimal string
  liquidity_cap_error?: string;
  fees_data?: { volume_24h?: number } | null;
  balances: { denom: string; amount: string }[];
  // The on-chain pool id. GAMM / stableswap / concentrated-liquidity pools (types 0/1/2) carry it as
  // `id`; CosmWasm pools (type 3) as `pool_id`. Read both (see poolIdOf in lib/sqsAdapter.ts) — only
  // reading `pool_id` would drop every CL pool, i.e. the deepest Osmosis liquidity.
  chain_model?: { id?: number; pool_id?: number } | null;
};

export type SqsPoolsFetcher = (baseUrl: string, minLiquidityCapUsd: number) => Promise<SqsPool[]>;
// Resolve each base denom's price in quoteDenom terms (SQS quotes everything in a USD denom).
export type SqsPricesFetcher = (baseUrl: string, baseDenoms: string[], quoteDenom: string) => Promise<Map<string, number>>;

// The safety floor for the pool-discovery fetch when no curation floor is supplied. The FULL /pools
// response (every Osmosis pool, ~4 MB) is too large to fetch reliably, so discovery is ALWAYS bounded
// by ?min_liquidity_cap; this is the fallback so a 0/unset floor never triggers the unbounded fetch.
export const DEFAULT_DISCOVERY_FLOOR_USD = 10000;

const trimUrl = (u: string): string => u.replace(/\/+$/, "");

const httpGetJson = async (url: string): Promise<unknown> => {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch {
    return null;
  }
};

// Fetch the pools whose USD liquidity clears minLiquidityCapUsd, via SQS's ?min_liquidity_cap filter.
// This bounds the response to a small, reliably-fetchable size (the unfiltered /pools is ~4 MB and
// fails to download intact) AND pre-filters to the liquid pools the verdict would keep — the caller
// passes the source's curation floor so discovery fetches exactly the eligible set. A fetch/transport
// failure yields an empty list (the ingest then has no data, rather than throwing).
export const fetchSqsPools: SqsPoolsFetcher = async (baseUrl, minLiquidityCapUsd) => {
  const cap = Math.floor(minLiquidityCapUsd > 0 ? minLiquidityCapUsd : DEFAULT_DISCOVERY_FLOOR_USD);
  const json = await httpGetJson(`${trimUrl(baseUrl)}/pools?min_liquidity_cap=${cap}`);
  return Array.isArray(json) ? (json as SqsPool[]) : [];
};

// How many base denoms to price per /tokens/prices call — keeps the query string bounded when pricing
// hundreds of discovered tokens.
const PRICE_BATCH = 100;

// Batch-resolve denom → USD price. SQS GET /tokens/prices?base=<d1,d2,...> responds with
// {"<denom>":{"<quoteDenom>":"<price>"}}; we read out the quoteDenom price per base. Unparseable or
// missing quotes are simply omitted (the caller treats an absent price as 0).
export const fetchSqsPrices: SqsPricesFetcher = async (baseUrl, baseDenoms, quoteDenom) => {
  const out = new Map<string, number>();
  const base = trimUrl(baseUrl);
  for (let i = 0; i < baseDenoms.length; i += PRICE_BATCH) {
    const chunk = baseDenoms.slice(i, i + PRICE_BATCH);
    const json = (await httpGetJson(`${base}/tokens/prices?base=${chunk.join(",")}`)) as Record<string, Record<string, string>> | null;
    for (const [denom, quotes] of Object.entries(json ?? {})) {
      const price = parseFloat(quotes?.[quoteDenom] ?? "");
      if (Number.isFinite(price)) {
        out.set(denom, price);
      }
    }
  }
  return out;
};
