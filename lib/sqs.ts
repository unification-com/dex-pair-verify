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
  chain_model?: { pool_id?: number } | null;
};

export type SqsPoolsFetcher = (baseUrl: string) => Promise<SqsPool[]>;
// Resolve each base denom's price in quoteDenom terms (SQS quotes everything in a USD denom).
export type SqsPricesFetcher = (baseUrl: string, baseDenoms: string[], quoteDenom: string) => Promise<Map<string, number>>;

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

// Fetch the whole pool set. SQS returns it as one JSON array (~4 MB); a fetch/transport failure
// yields an empty list (the ingest then has no data, rather than throwing).
export const fetchSqsPools: SqsPoolsFetcher = async (baseUrl) => {
  const json = await httpGetJson(`${trimUrl(baseUrl)}/pools`);
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
