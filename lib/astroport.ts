// lib/astroport.ts
// Minimal client for the Astroport public REST API (api.astroport.fi) — the Neutron analogue of the
// Osmosis SQS transport. One GET /api/pools?chainId=<id> returns every pool with its assets inline:
// each asset carries denom + symbol + decimals + priceUSD, plus the pool's totalLiquidityUSD and
// dayVolumeUSD. Richer than SQS (USD prices + liquidity + real volume in ONE call, no separate prices
// fetch). Pure HTTP/JSON, transport injectable so the adapter's tests run without a network call.

export const DEFAULT_ASTROPORT_URL = "https://api.astroport.fi";

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
