// lib/gtAdapter.ts
// The GeckoTerminal/EVM IngestAdapter (#128 Phase 2a). Holds everything GeckoTerminal-specific that
// used to live inline in lib/ingest.ts: the response shapes, the transport (one keyed call per
// page, tokens embedded via `include`), the normalisation (GT ids/attributes → the source-neutral
// NormalisedPool/NormalisedToken, with native-currency tokens mapped to the chain's wrapped token),
// and the pricing-subgraph corroboration. The orchestrator (lib/ingest.ts) now talks only to the
// IngestAdapter seam, so this is the one place that knows GeckoTerminal exists.
//
// Behaviour is identical to the pre-refactor inline code — proven by the existing ingest tests,
// which stub the same injectable page fetcher.

import { utils as web3Utils } from "web3";

import { cgKeyedFetch, GECKO_API_KEY } from "./coingecko";
import {
  emptyPoolFacts,
  IngestAdapter,
  NormalisedPage,
  NormalisedPool,
  NormalisedToken,
  PoolFacts,
  PoolPageRequest,
} from "./ingestAdapter";
import { FAMILY_COLLECTION } from "./priceFetch";
import { getSource, resolveSubgraphUrl } from "./sourceConfig";
import { isNativeCurrency, poolAddressFromGt, wrappedNativeToken } from "./univ4";

// With a (free Demo) CoinGecko API key, use CoinGecko's keyed on-chain endpoints — same data as
// GeckoTerminal, but a dedicated rate limit instead of the shared-IP public one. Without a key, fall
// back to the public GT API.
const GT_BASE = GECKO_API_KEY
  ? "https://api.coingecko.com/api/v3/onchain"
  : "https://api.geckoterminal.com/api/v2";

// --- GeckoTerminal response shapes (only the fields we consume) ----------

type GtPool = {
  attributes: {
    address: string;
    reserve_in_usd: string | null;
    market_cap_usd: string | null;
    pool_created_at: string | null;
    base_token_price_usd: string | null;
    quote_token_price_usd: string | null;
    price_change_percentage: { h24: string | null } | null;
    transactions: { h24: { buys: number | null; sells: number | null; buyers: number | null; sellers: number | null } | null } | null;
    volume_usd: { h24: string | null } | null;
  };
  relationships: {
    base_token: { data: { id: string } | null } | null;
    quote_token: { data: { id: string } | null } | null;
    // Present on the /tokens/{addr}/pools endpoint (pools span DEXs) — used by the targeted
    // first-party ingest to map a pool to one of our supported sources.
    dex?: { data: { id: string } | null } | null;
  };
};

type GtToken = {
  attributes: {
    address: string;
    name: string | null;
    symbol: string | null;
    decimals: number | null;
    coingecko_coin_id: string | null;
    // Only present on the standalone /tokens endpoint, not the embedded include= tokens — optional
    // so both shapes type-check.
    price_usd?: string | null;
    market_cap_usd?: string | null;
    total_supply?: string | null;
    volume_usd?: { h24: string | null } | null;
  };
};

// One GeckoTerminal call per page returns the pools AND (via `include`) their base/quote tokens
// embedded — so we don't make a second tokens call. Halves the request rate against GT's free-tier
// limit.
export type PoolPage = { pools: GtPool[]; tokens: GtToken[] };
export type PoolPageFetcher = (chain: string, dex: string, page: number) => Promise<PoolPage>;

async function gtFetch(url: string, label: string): Promise<{ data?: unknown[]; included?: unknown[] } | null> {
  // Rate-paced through the shared CoinGecko gate so ingest can't overrun the keyed per-minute window
  // (the canonical pass shares the same budget).
  const res = await cgKeyedFetch(url, `ingest ${label}`);
  if (!res) {
    return null;
  }
  return (await res.json()) as { data?: unknown[]; included?: unknown[] };
}

const defaultPoolPageFetcher: PoolPageFetcher = async (chain, dex, page) => {
  const url = `${GT_BASE}/networks/${chain}/dexes/${dex}/pools?page=${page}&sort=h24_tx_count_desc&include=base_token,quote_token`;
  const json = await gtFetch(url, `pools ${chain}/${dex} p${page}`);
  const pools = (json?.data as GtPool[]) ?? [];
  const tokens = ((json?.included as ({ type?: string } & GtToken)[]) ?? []).filter((r) => r.type === "token");
  return { pools, tokens };
};

// --- helpers -------------------------------------------------------------

const num = (v: string | number | null | undefined): number => {
  const n = typeof v === "number" ? v : parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};

// GeckoTerminal token relationship ids are `{network}_{address}`.
const addressFromGtId = (id: string | undefined): string | null => {
  if (!id) {
    return null;
  }
  const parts = id.split("_");
  const raw = parts[parts.length - 1];
  try {
    return web3Utils.toChecksumAddress(raw);
  } catch {
    return null;
  }
};

const isoToUnix = (iso: string | null): number | null => {
  if (!iso) {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
};

// GeckoTerminal token attributes → the market/identity fields dpv stores. Used to build the page's
// raw token map (keyed by the token's own checksummed address) before native-currency resolution.
type GtTokenData = Omit<NormalisedToken, "address">;

const mapGtToken = (t: GtToken): GtTokenData => ({
  name: t.attributes.name ?? "",
  symbol: t.attributes.symbol ?? "",
  decimals: t.attributes.decimals ?? 0,
  coingeckoCoinId: t.attributes.coingecko_coin_id ?? "",
  priceUsd: num(t.attributes.price_usd),
  marketCapUsd: num(t.attributes.market_cap_usd),
  totalSupply: num(t.attributes.total_supply),
  volume24hUsd: num(t.attributes.volume_usd?.h24),
});

// Build the raw address → GtTokenData map from the embedded `include` tokens (pre native-currency
// resolution; keyed by each token's own checksummed address).
const buildRawTokenMap = (tokens: GtToken[]): Map<string, GtTokenData> => {
  const tokenMap = new Map<string, GtTokenData>();
  for (const t of tokens) {
    const addr = addressFromGtId(t.attributes.address) ?? web3Utils.toChecksumAddress(t.attributes.address);
    tokenMap.set(addr, mapGtToken(t));
  }
  return tokenMap;
};

// Resolve one pool-side token to its stored (address, NormalisedToken), mapping a v4 native-currency
// token (address 0x0) to the chain's wrapped token. Native ETH has no coingecko_coin_id on
// GeckoTerminal, so without this a v4 ETH pool could never be canonically keyed or aggregate with the
// wrapped-ETH pairs on other DEXs (see lib/univ4.ts). The resolved token is written into `out` (the
// page's token map) ONLY when GeckoTerminal supplied its data — a pool whose token data is missing is
// dropped downstream, exactly as before. Returns the resolved (possibly wrapped) address either way.
const resolveTokenEntry = (
  chain: string,
  address: string,
  raw: Map<string, GtTokenData>,
  out: Map<string, NormalisedToken>,
): string => {
  const wrapped = isNativeCurrency(address) ? wrappedNativeToken(chain) : null;
  const finalAddr = wrapped ? wrapped.address : address;
  const data = raw.get(address);
  if (data) {
    out.set(
      finalAddr,
      wrapped
        ? {
            ...data,
            address: finalAddr,
            symbol: wrapped.symbol,
            name: wrapped.name,
            coingeckoCoinId: wrapped.coingeckoCoinId,
            decimals: wrapped.decimals,
          }
        : { ...data, address: finalAddr },
    );
  }
  return finalAddr;
};

// Normalise a page of GeckoTerminal pools + tokens to the source-neutral shape. A pool with an
// unresolvable id or a missing base/quote token relationship is dropped here (it could never be
// ingested anyway), so `pools` may be shorter than the raw input — the orchestrator tracks the raw
// count separately for pagination.
export function normaliseGtPage(
  chain: string,
  gtPools: GtPool[],
  gtTokens: GtToken[],
): { pools: NormalisedPool[]; tokens: Map<string, NormalisedToken> } {
  const raw = buildRawTokenMap(gtTokens);
  const tokens = new Map<string, NormalisedToken>();
  const pools: NormalisedPool[] = [];

  for (const p of gtPools) {
    const poolId = poolAddressFromGt(p.attributes.address);
    const t0Addr = addressFromGtId(p.relationships.base_token?.data?.id);
    const t1Addr = addressFromGtId(p.relationships.quote_token?.data?.id);
    if (!poolId || !t0Addr || !t1Addr) {
      continue;
    }
    const baseAddress = resolveTokenEntry(chain, t0Addr, raw, tokens);
    const quoteAddress = resolveTokenEntry(chain, t1Addr, raw, tokens);

    const a = p.attributes;
    const buys = a.transactions?.h24?.buys ?? 0;
    const sells = a.transactions?.h24?.sells ?? 0;
    pools.push({
      poolId,
      baseAddress,
      quoteAddress,
      dexId: p.relationships.dex?.data?.id ?? undefined,
      reserveUsd: num(a.reserve_in_usd),
      volume24hUsd: num(a.volume_usd?.h24),
      marketCapUsd: num(a.market_cap_usd),
      priceChange24h: num(a.price_change_percentage?.h24),
      buys24h: buys,
      sells24h: sells,
      buyers24h: a.transactions?.h24?.buyers ?? 0,
      sellers24h: a.transactions?.h24?.sellers ?? 0,
      baseTokenPriceUsd: num(a.base_token_price_usd),
      quoteTokenPriceUsd: num(a.quote_token_price_usd),
      poolCreatedAt: isoToUnix(a.pool_created_at),
    });
  }

  return { pools, tokens };
}

// Corroborate normalised pools against the source's PRICING subgraph — the same subgraph and id_in
// lookup go-ooo prices through, so "present" means "go-ooo can actually price it". One batched query
// per call, mirroring go-ooo's own id_in price lookup. A non-subgraph family, an unconfigured
// subgraph, or any fetch/GraphQL error returns idsAlign=false with empty maps: corroboration then
// makes NO claim (fail-open), and go-ooo's no-hook + num_pools price filters remain the backstop, so
// this never wrongly demotes a working source or opens a safety gap.
async function gtCorroborate(chain: string, dex: string, pools: NormalisedPool[]): Promise<PoolFacts> {
  const source = await getSource(chain, dex);
  const family = source?.subgraphSchemaFamily;
  const collection = family ? FAMILY_COLLECTION[family] : undefined;
  const url = source ? resolveSubgraphUrl(source) : null;
  if (!collection || !url) {
    return emptyPoolFacts(); // custom / no-subgraph family — nothing to corroborate against
  }
  const poolIds = pools.map((p) => p.poolId.toLowerCase());
  if (poolIds.length === 0) {
    return emptyPoolFacts();
  }
  const idList = poolIds.map((id) => `"${id}"`).join(",");
  const fields = family === "univ4" ? "id hooks" : "id";
  const query = `{ ${collection}(where: { id_in: [${idList}] }) { ${fields} } }`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      return emptyPoolFacts();
    }
    const json = (await res.json()) as { data?: Record<string, { id?: string; hooks?: string }[]> } | null;
    const rows = json?.data?.[collection];
    if (!Array.isArray(rows)) {
      return emptyPoolFacts(); // GraphQL error / unexpected shape → make no claim
    }
    const present = new Set<string>();
    const hooks = new Map<string, string>();
    for (const r of rows) {
      if (!r?.id) {
        continue;
      }
      const id = r.id.toLowerCase();
      present.add(id);
      if (family === "univ4" && typeof r.hooks === "string") {
        hooks.set(id, r.hooks);
      }
    }
    return { idsAlign: present.size > 0, present, hooks };
  } catch {
    // Subgraph/network failure — corroboration makes no claim (go-ooo's price filters are the backstop).
    return emptyPoolFacts();
  }
}

// --- token-pools + single-pool transports (GeckoTerminal-specific entry points) -------------------

// Fetch EVERY pool for one token (across DEXs), tokens embedded via `include`.
export type TokenPoolsFetcher = (gtNetwork: string, address: string) => Promise<PoolPage>;

export const defaultTokenPoolsFetcher: TokenPoolsFetcher = async (gtNetwork, address) => {
  const url = `${GT_BASE}/networks/${gtNetwork}/tokens/${address}/pools?include=base_token,quote_token`;
  const json = await gtFetch(url, `token-pools ${gtNetwork}/${address}`);
  const pools = (json?.data as GtPool[]) ?? [];
  const tokens = ((json?.included as ({ type?: string } & GtToken)[]) ?? []).filter((r) => r.type === "token");
  return { pools, tokens };
};

// Fetch ONE pool by its contract address (tokens embedded via `include`). GT's single-pool endpoint
// returns `data` as an object, not an array — so we read it directly rather than through the
// array-shaped gtFetch helper.
export type PoolByAddressFetcher = (gtNetwork: string, address: string) => Promise<{ pool: GtPool | null; tokens: GtToken[] }>;

export const defaultPoolByAddressFetcher: PoolByAddressFetcher = async (gtNetwork, address) => {
  const url = `${GT_BASE}/networks/${gtNetwork}/pools/${address}?include=base_token,quote_token`;
  const res = await cgKeyedFetch(url, `pool ${gtNetwork}/${address}`);
  if (!res) {
    return { pool: null, tokens: [] };
  }
  const json = (await res.json()) as { data?: GtPool | null; included?: ({ type?: string } & GtToken)[] } | null;
  const pool = (json?.data as GtPool) ?? null;
  const tokens = (json?.included ?? []).filter((r) => r.type === "token");
  return { pool, tokens };
};

// --- the adapter ----------------------------------------------------------

// The GeckoTerminal/EVM ingest adapter. `poolPage` transports (the injectable fetcher, defaulting to
// the live GT endpoint) → normalises → corroborates one source page; `corroborate` is exposed for the
// per-pool token-pools / manual-add paths in the orchestrator.
export const gtAdapter: IngestAdapter = {
  kind: "evm",

  async poolPage(chain, dex, page, req: PoolPageRequest): Promise<NormalisedPage> {
    const fetcher = (req.poolFetcher as PoolPageFetcher | undefined) ?? defaultPoolPageFetcher;
    const { pools: gtPools, tokens: gtTokens } = await fetcher(req.gtNetwork ?? chain, req.gtDex ?? dex, page);
    if (gtPools.length === 0) {
      return { poolCount: 0, pools: [], tokens: new Map(), facts: emptyPoolFacts() };
    }
    const { pools, tokens } = normaliseGtPage(chain, gtPools, gtTokens);
    const facts = await gtCorroborate(chain, dex, pools);
    return { poolCount: gtPools.length, pools, tokens, facts };
  },

  corroborate: gtCorroborate,
};
