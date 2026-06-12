// GeckoTerminal-only ingest (A.4.1). One pass per (chain, dex) page: discover
// pools + hydrate reserves/volume/prices + token cgId/decimals, then run the
// verdict inline. Replaces the old 3-script flow (GeckoTerminal discover → DEX
// subgraph reserves → GeckoTerminal token data) — GT supplies everything the
// verdict needs, so the Apollo/subgraph path (and its per-DEX GraphQL config)
// drops off the verification critical path. Precise on-chain reserves remain
// go-ooo's concern, not the verdict's.

import { utils as web3Utils } from "web3";

import { cgKeyedFetch, GECKO_API_KEY } from "./coingecko";
import prisma from "./prisma";
import { getSource, getSources, gtDexFor, gtNetworkFor, thresholdSeedData } from "./sourceConfig";
import { isNativeCurrency, poolAddressFromGt, wrappedNativeToken } from "./univ4";
import { runVerdictForPair } from "./verdictRunner";

// With a (free Demo) CoinGecko API key, use CoinGecko's keyed on-chain
// endpoints — same data as GeckoTerminal, but a dedicated rate limit instead of
// the shared-IP public one. Without a key, fall back to the public GT API.
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
    // Present on the /tokens/{addr}/pools endpoint (pools span DEXs) — used by the
    // targeted first-party ingest to map a pool to one of our supported sources.
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
    // Only present on the standalone /tokens endpoint, not the embedded
    // include= tokens — optional so both shapes type-check.
    price_usd?: string | null;
    market_cap_usd?: string | null;
    total_supply?: string | null;
    volume_usd?: { h24: string | null } | null;
  };
};

// One GeckoTerminal call per page returns the pools AND (via `include`) their
// base/quote tokens embedded — so we don't make a second tokens call. Halves
// the request rate against GT's free-tier limit.
export type PoolPage = { pools: GtPool[]; tokens: GtToken[] };
export type PoolPageFetcher = (chain: string, dex: string, page: number) => Promise<PoolPage>;

async function gtFetch(url: string, label: string): Promise<{ data?: unknown[]; included?: unknown[] } | null> {
  // Rate-paced through the shared CoinGecko gate so ingest can't overrun the
  // keyed per-minute window (the canonical pass shares the same budget).
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

// Resolve a pool token to the (address, GeckoTerminal data) dpv should store, mapping a v4
// native-currency token (address 0x0) to the chain's wrapped token. Native ETH has no
// coingecko_coin_id on GeckoTerminal, so without this a v4 ETH pool could never be canonically
// keyed or aggregate with the wrapped-ETH pairs on other DEXs (see lib/univ4.ts). Non-native
// tokens, and chains with no wrapped mapping, pass through unchanged.
const resolveNativeToken = (chain: string, address: string, gt: GtTokenData): { address: string; gt: GtTokenData } => {
  const wrapped = isNativeCurrency(address) ? wrappedNativeToken(chain) : null;
  if (!wrapped) {
    return { address, gt };
  }
  return {
    address: wrapped.address,
    gt: { ...gt, symbol: wrapped.symbol, name: wrapped.name, coingeckoCoinId: wrapped.coingeckoCoinId, decimals: wrapped.decimals },
  };
};

const isoToUnix = (iso: string | null): number | null => {
  if (!iso) {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
};

type GtTokenData = {
  name: string;
  symbol: string;
  decimals: number;
  coingeckoCoinId: string;
  priceUsd: number;
  marketCapUsd: number;
  totalSupply: number;
  volume24hUsd: number;
};

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

// Find-or-update a token from GeckoTerminal data. Never touches status /
// verificationMethod (those belong to the verdict/operator). deploymentTimestamp
// keeps the earliest pool_created_at seen.
async function upsertToken(
  chain: string,
  address: string,
  gt: GtTokenData,
  poolCreatedAt: number | null,
  now: number,
): Promise<string> {
  const existing = await prisma.token.findFirst({ where: { chain, contractAddress: address } });
  const common = {
    name: gt.name,
    symbol: gt.symbol,
    decimals: gt.decimals,
    coingeckoCoinId: gt.coingeckoCoinId,
    totalSupply: gt.totalSupply,
    volume24hUsd: gt.volume24hUsd,
    marketCapUsd: gt.marketCapUsd,
    lastChecked: now,
  };

  if (existing) {
    const deploymentTimestamp =
      poolCreatedAt === null
        ? existing.deploymentTimestamp
        : Math.min(existing.deploymentTimestamp ?? poolCreatedAt, poolCreatedAt);
    await prisma.token.update({ where: { id: existing.id }, data: { ...common, deploymentTimestamp } });
    return existing.id;
  }

  const created = await prisma.token.create({
    data: {
      chain,
      contractAddress: address,
      txCount: 0,
      deploymentTimestamp: poolCreatedAt,
      createdAt: now,
      ...common,
    },
  });
  return created.id;
}

// Find-or-update a pair from GeckoTerminal pool data. Never touches the verdict
// columns (status / verificationMethod / canonicalKey / confidence / verdictAt)
// — runVerdictForPair owns those and runs right after.
async function upsertPair(
  chain: string,
  dex: string,
  address: string,
  pairSym: string,
  token0Id: string,
  token1Id: string,
  pool: GtPool,
  now: number,
): Promise<string> {
  const a = pool.attributes;
  const buys = a.transactions?.h24?.buys ?? 0;
  const sells = a.transactions?.h24?.sells ?? 0;
  const volume24h = num(a.volume_usd?.h24);

  const common = {
    pair: pairSym,
    reserveUsd: num(a.reserve_in_usd),
    reserve0: 0,
    reserve1: 0,
    reserveNativeCurrency: 0,
    volumeUsd: volume24h,
    volumeUsd24h: volume24h,
    marketCapUsd: num(a.market_cap_usd),
    priceChangePercentage24h: num(a.price_change_percentage?.h24),
    buys24h: buys,
    sells24h: sells,
    buyers24h: a.transactions?.h24?.buyers ?? 0,
    sellers24h: a.transactions?.h24?.sellers ?? 0,
    txCount: buys + sells, // 24h activity proxy (GT gives no lifetime count)
    // token0 = base, token1 = quote. DEX price = this pool's USD price;
    // CG price = the token's GT-aggregated price_usd (set on the token side).
    token0PriceDex: num(a.base_token_price_usd),
    token1PriceDex: num(a.quote_token_price_usd),
    lastChecked: now,
  };

  const existing = await prisma.pair.findFirst({ where: { chain, dex, contractAddress: address } });
  if (existing) {
    await prisma.pair.update({ where: { id: existing.id }, data: common });
    return existing.id;
  }

  const created = await prisma.pair.create({
    data: {
      chain,
      dex,
      contractAddress: address,
      token0Id,
      token1Id,
      createdAt: now,
      ...common,
    },
  });
  return created.id;
}

// Ingest ONE GeckoTerminal pool into a (chain, dex): hydrate both tokens + the
// pair, set the pair's CG prices, run the verdict inline. Returns the verdict tally
// key, or null when the pool can't be ingested (missing addresses / token data).
// Shared by the page ingest and the targeted first-party ingest (DRY).
async function ingestOnePool(
  chain: string,
  dex: string,
  p: GtPool,
  tokenMap: Map<string, GtTokenData>,
  now: number,
): Promise<string | null> {
  const pairAddr = poolAddressFromGt(p.attributes.address);
  const t0Addr = addressFromGtId(p.relationships.base_token?.data?.id);
  const t1Addr = addressFromGtId(p.relationships.quote_token?.data?.id);
  if (!pairAddr || !t0Addr || !t1Addr) {
    return null;
  }
  const gt0 = tokenMap.get(t0Addr);
  const gt1 = tokenMap.get(t1Addr);
  if (!gt0 || !gt1) {
    return null; // GT returned no token data — skip rather than write blanks
  }
  // Map a v4 native-currency token (address 0x0) to the chain's wrapped token, so it carries a
  // CoinGecko-keyable identity and the pair aggregates with the wrapped-ETH pairs on other DEXs.
  const r0 = resolveNativeToken(chain, t0Addr, gt0);
  const r1 = resolveNativeToken(chain, t1Addr, gt1);

  const poolCreatedAt = isoToUnix(p.attributes.pool_created_at);
  const token0Id = await upsertToken(chain, r0.address, r0.gt, poolCreatedAt, now);
  const token1Id = await upsertToken(chain, r1.address, r1.gt, poolCreatedAt, now);
  const pairId = await upsertPair(chain, dex, pairAddr, `${r0.gt.symbol}-${r1.gt.symbol}`, token0Id, token1Id, p, now);

  // The pair's CG (aggregated) prices come from the token-level price_usd.
  await prisma.pair.update({
    where: { id: pairId },
    data: { token0PriceCg: r0.gt.priceUsd, token1PriceCg: r1.gt.priceUsd },
  });

  const out = await runVerdictForPair(pairId);
  return out.skippedManual ? "skippedManual" : out.result?.verdict ?? "error";
}

// Build the address → GtTokenData map from the embedded `include` tokens.
const buildTokenMap = (tokens: GtToken[]): Map<string, GtTokenData> => {
  const tokenMap = new Map<string, GtTokenData>();
  for (const t of tokens) {
    const addr = addressFromGtId(t.attributes.address) ?? web3Utils.toChecksumAddress(t.attributes.address);
    tokenMap.set(addr, mapGtToken(t));
  }
  return tokenMap;
};

// Ensure the per-(chain, dex) Threshold row exists so the verdict applies this
// source's tuned floors (liquidity + minTxCount) inline at ingest. Idempotent;
// creates once per source. Shared by page ingest, token-pools ingest and the
// manual add-by-address path (DRY).
async function ensureThreshold(chain: string, dex: string): Promise<void> {
  if (!(await prisma.threshold.findFirst({ where: { chain, dex } }))) {
    await prisma.threshold.create({ data: thresholdSeedData(chain, dex) });
  }
}

export type IngestPageResult = {
  hadData: boolean;
  poolCount: number;
  pairs: number;
  tallies: Record<string, number>;
};

// Ingest one GeckoTerminal pool page for a (chain, dex): hydrate every pool's
// tokens + pair, then run the verdict inline. Returns whether the page had data
// (so the caller can stop paginating) and the verdict tally.
export async function ingestPoolPage(
  chain: string,
  dex: string,
  page: number,
  opts: { now?: number; poolFetcher?: PoolPageFetcher; gtNetwork?: string; gtDex?: string } = {},
): Promise<IngestPageResult> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const poolFetcher = opts.poolFetcher ?? defaultPoolPageFetcher;
  // Our internal chain/dex ids (stored on the row) can differ from
  // GeckoTerminal's slugs (e.g. bsc_pancakeswap_v3 vs pancakeswap-v3-bsc) —
  // query GT by the slug, store by the internal id.
  const gtNetwork = opts.gtNetwork ?? chain;
  const gtDex = opts.gtDex ?? dex;

  await ensureThreshold(chain, dex);

  const { pools, tokens } = await poolFetcher(gtNetwork, gtDex, page);
  if (pools.length === 0) {
    return { hadData: false, poolCount: 0, pairs: 0, tallies: {} };
  }

  // Tokens arrive embedded in the pools response (via GT `include`).
  const tokenMap = buildTokenMap(tokens);

  const tallies: Record<string, number> = {};
  let pairs = 0;
  for (const p of pools) {
    const key = await ingestOnePool(chain, dex, p, tokenMap, now);
    if (key === null) {
      continue;
    }
    tallies[key] = (tallies[key] ?? 0) + 1;
    pairs += 1;
  }

  return { hadData: true, poolCount: pools.length, pairs, tallies };
}

// --- token-pools ingest (all of a token's pools across DEXs) --------------

// Fetch EVERY pool for one token (across DEXs), tokens embedded via `include`.
export type TokenPoolsFetcher = (gtNetwork: string, address: string) => Promise<PoolPage>;

const defaultTokenPoolsFetcher: TokenPoolsFetcher = async (gtNetwork, address) => {
  const url = `${GT_BASE}/networks/${gtNetwork}/tokens/${address}/pools?include=base_token,quote_token`;
  const json = await gtFetch(url, `token-pools ${gtNetwork}/${address}`);
  const pools = (json?.data as GtPool[]) ?? [];
  const tokens = ((json?.included as ({ type?: string } & GtToken)[]) ?? []).filter((r) => r.type === "token");
  return { pools, tokens };
};

export type TokenPoolsIngestResult = { ingested: number; skipped: number; tallies: Record<string, number> };

// Fetch every supported-DEX pool for a token on a chain and ingest each (verdict
// inline). The page ingest only takes the top-ranked pools per DEX, so this is how
// a specific token's pools land in the DB. Used by the first-party ingest pass (our
// own tokens), by manual token-add and by the cross-chain spider. A pool on a DEX
// with no SupportedSource is skipped (no subgraph → not exportable to go-ooo).
export async function ingestTokenPools(
  chain: string,
  address: string,
  opts: { now?: number; fetcher?: TokenPoolsFetcher } = {},
): Promise<TokenPoolsIngestResult> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const fetcher = opts.fetcher ?? defaultTokenPoolsFetcher;

  // Map each supported source's GT dex slug → our internal dex id (and the GT
  // network slug). Only pools whose DEX is in this map get ingested.
  const sources = (await getSources()).filter((s) => s.chain === chain);
  if (sources.length === 0) {
    return { ingested: 0, skipped: 0, tallies: {} };
  }
  const gtNetwork = gtNetworkFor(sources[0]);
  const dexByGtSlug = new Map<string, string>();
  for (const s of sources) {
    dexByGtSlug.set(gtDexFor(s), s.dex);
    await ensureThreshold(chain, s.dex);
  }

  const { pools, tokens } = await fetcher(gtNetwork, address);
  const tokenMap = buildTokenMap(tokens);

  const tallies: Record<string, number> = {};
  let ingested = 0;
  let skipped = 0;
  for (const p of pools) {
    const gtDexSlug = p.relationships.dex?.data?.id;
    const dex = gtDexSlug ? dexByGtSlug.get(gtDexSlug) : undefined;
    if (!dex) {
      skipped += 1; // pool on a DEX we don't support — can't export it
      continue;
    }
    const key = await ingestOnePool(chain, dex, p, tokenMap, now);
    if (key === null) {
      skipped += 1;
      continue;
    }
    tallies[key] = (tallies[key] ?? 0) + 1;
    ingested += 1;
  }
  return { ingested, skipped, tallies };
}

// --- manual add by pool address ------------------------------------------

// Fetch ONE pool by its contract address (tokens embedded via `include`). GT's
// single-pool endpoint returns `data` as an object, not an array — so we read it
// directly rather than through the array-shaped gtFetch helper.
export type PoolByAddressFetcher = (gtNetwork: string, address: string) => Promise<{ pool: GtPool | null; tokens: GtToken[] }>;

const defaultPoolByAddressFetcher: PoolByAddressFetcher = async (gtNetwork, address) => {
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

// Flat result (strictNullChecks is off in this project, so a discriminated union
// wouldn't narrow on `ok` — callers read the optional fields directly).
export type AddPairByAddressResult = {
  ok: boolean;
  reason?: string;
  pairId?: string;
  token0Id?: string;
  token1Id?: string;
  verdict?: string | null;
  pairSymbol?: string;
};

// Manually add ONE pair by its contract address: fetch the pool from GeckoTerminal,
// hydrate both tokens + the pair, run the verdict inline (the same path as page
// ingest). The (chain, dex) must be a supported source. Returns ok:false with a
// human-readable reason when GT doesn't know the pool, it's on a different DEX, or
// the data is incomplete.
export async function ingestPairByAddress(
  chain: string,
  dex: string,
  address: string,
  opts: { now?: number; fetcher?: PoolByAddressFetcher } = {},
): Promise<AddPairByAddressResult> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const fetcher = opts.fetcher ?? defaultPoolByAddressFetcher;

  const source = await getSource(chain, dex);
  if (!source) {
    return { ok: false, reason: `${chain}/${dex} is not a supported source` };
  }

  const poolAddr = poolAddressFromGt(address);
  if (!poolAddr) {
    return { ok: false, reason: `invalid pool address: ${address}` };
  }

  await ensureThreshold(chain, dex);

  const gtNetwork = gtNetworkFor(source);
  const gtDex = gtDexFor(source);
  const { pool, tokens } = await fetcher(gtNetwork, poolAddr);
  if (!pool) {
    return { ok: false, reason: `GeckoTerminal has no pool ${poolAddr} on ${gtNetwork}` };
  }

  // Guard: the pool must actually be on the selected DEX (GT tags each pool's dex).
  const gtPoolDex = pool.relationships.dex?.data?.id;
  if (gtPoolDex && gtPoolDex !== gtDex) {
    return { ok: false, reason: `pool is on '${gtPoolDex}', not '${gtDex}' — pick the matching DEX` };
  }

  const verdict = await ingestOnePool(chain, dex, pool, buildTokenMap(tokens), now);
  if (verdict === null) {
    return { ok: false, reason: "GeckoTerminal returned incomplete pool/token data" };
  }

  const pair = await prisma.pair.findFirst({
    where: { chain, dex, contractAddress: poolAddr },
    select: { id: true, token0Id: true, token1Id: true, pair: true },
  });
  if (!pair) {
    return { ok: false, reason: "pair not found after ingest" };
  }
  return { ok: true, pairId: pair.id, token0Id: pair.token0Id, token1Id: pair.token1Id, verdict, pairSymbol: pair.pair };
}
