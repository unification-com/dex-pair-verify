// lib/astroport.ts
// Minimal client for the Astroport public REST API (api.astroport.fi) — the Neutron analogue of the
// Osmosis SQS transport. One GET /api/pools?chainId=<id> returns every pool with its assets inline:
// each asset carries denom + symbol + decimals + priceUSD, plus the pool's totalLiquidityUSD and
// dayVolumeUSD. Richer than SQS (USD prices + liquidity + real volume in ONE call, no separate prices
// fetch). Pure HTTP/JSON, transport injectable so the adapter's tests run without a network call.

export const DEFAULT_ASTROPORT_URL = "https://api.astroport.fi";

// The Cosmos chain id Astroport is queried by, per our internal chain key.
export const ASTROPORT_CHAIN_ID: Record<string, string> = {
  neutron: "neutron-1",
};

// The slice of an Astroport pool asset we consume.
export type AstroportAsset = {
  denom: string;
  symbol: string;
  decimals: number;
  priceUSD: number;
};

// The slice of an Astroport pool we consume (the endpoint returns more per pool).
export type AstroportPool = {
  poolAddress: string;
  poolType: string;
  isDeregistered: boolean;
  assets: AstroportAsset[];
  totalLiquidityUSD: number;
  dayVolumeUSD: number;
};

export type AstroportPoolsFetcher = (baseUrl: string, chainId: string) => Promise<AstroportPool[]>;

// Fetch every pool for a chain id (e.g. "neutron-1"). A fetch/transport failure yields an empty list
// (the ingest then has no data, rather than throwing).
export const fetchAstroportPools: AstroportPoolsFetcher = async (baseUrl, chainId) => {
  try {
    const url = `${baseUrl.replace(/\/+$/, "")}/api/pools?chainId=${encodeURIComponent(chainId)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      return [];
    }
    const json = await res.json();
    return Array.isArray(json) ? (json as AstroportPool[]) : [];
  } catch {
    return [];
  }
};

// Each denom's USD price, from the deepest active pool holding it (absent when none prices it): the same
// rule as go-ooo's Astroport client, which prices a pair as base USD ÷ target USD.
export async function astroportUsdPrices(
  baseUrl: string,
  chain: string,
  denoms: string[],
  fetcher: AstroportPoolsFetcher = fetchAstroportPools,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const chainId = ASTROPORT_CHAIN_ID[chain];
  if (!chainId || denoms.length === 0) {
    return out;
  }
  const wanted = new Set(denoms);
  const depth = new Map<string, number>();
  for (const p of await fetcher(baseUrl, chainId)) {
    if (p.isDeregistered) {
      continue;
    }
    for (const a of p.assets ?? []) {
      if (wanted.has(a.denom) && a.priceUSD > 0 && (!depth.has(a.denom) || p.totalLiquidityUSD > (depth.get(a.denom) as number))) {
        out.set(a.denom, a.priceUSD);
        depth.set(a.denom, p.totalLiquidityUSD);
      }
    }
  }
  return out;
}
