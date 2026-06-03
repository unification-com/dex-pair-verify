// GeckoTerminal-only ingest (A.4.1). One pass per (chain, dex) page: discover
// pools + hydrate reserves/volume/prices + token cgId/decimals, then run the
// verdict inline. Replaces the old 3-script flow (GeckoTerminal discover → DEX
// subgraph reserves → GeckoTerminal token data) — GT supplies everything the
// verdict needs, so the Apollo/subgraph path (and its per-DEX GraphQL config)
// drops off the verification critical path. Precise on-chain reserves remain
// go-ooo's concern, not the verdict's.

import { utils as web3Utils } from "web3";

import prisma from "./prisma";
import { runVerdictForPair } from "./verdictRunner";

const GT_BASE = "https://api.geckoterminal.com/api/v2";

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
  };
};

type GtToken = {
  attributes: {
    address: string;
    name: string | null;
    symbol: string | null;
    decimals: number | null;
    coingecko_coin_id: string | null;
    price_usd: string | null;
    market_cap_usd: string | null;
    total_supply: string | null;
    volume_usd: { h24: string | null } | null;
  };
};

export type PoolPageFetcher = (chain: string, dex: string, page: number) => Promise<GtPool[]>;
export type TokensFetcher = (chain: string, addresses: string[]) => Promise<GtToken[]>;

const defaultPoolPageFetcher: PoolPageFetcher = async (chain, dex, page) => {
  const url = `${GT_BASE}/networks/${chain}/dexes/${dex}/pools?page=${page}&sort=h24_tx_count_desc`;
  const res = await fetch(url);
  if (!res.ok) {
    return [];
  }
  const json = await res.json();
  return (json?.data as GtPool[]) ?? [];
};

const defaultTokensFetcher: TokensFetcher = async (chain, addresses) => {
  if (addresses.length === 0) {
    return [];
  }
  const url = `${GT_BASE}/networks/${chain}/tokens/multi/${addresses.join("%2C")}`;
  const res = await fetch(url);
  if (!res.ok) {
    return [];
  }
  const json = await res.json();
  return (json?.data as GtToken[]) ?? [];
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

export type IngestPageResult = {
  hadData: boolean;
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
  opts: { now?: number; poolFetcher?: PoolPageFetcher; tokensFetcher?: TokensFetcher; gtNetwork?: string; gtDex?: string } = {},
): Promise<IngestPageResult> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const poolFetcher = opts.poolFetcher ?? defaultPoolPageFetcher;
  const tokensFetcher = opts.tokensFetcher ?? defaultTokensFetcher;
  // Our internal chain/dex ids (stored on the row) can differ from
  // GeckoTerminal's slugs (e.g. bsc_pancakeswap_v3 vs pancakeswap-v3-bsc) —
  // query GT by the slug, store by the internal id.
  const gtNetwork = opts.gtNetwork ?? chain;
  const gtDex = opts.gtDex ?? dex;

  const pools = await poolFetcher(gtNetwork, gtDex, page);
  if (pools.length === 0) {
    return { hadData: false, pairs: 0, tallies: {} };
  }

  // Collect the distinct token addresses on this page and hydrate them once.
  const tokenAddrs = new Set<string>();
  for (const p of pools) {
    const b = addressFromGtId(p.relationships.base_token?.data?.id);
    const q = addressFromGtId(p.relationships.quote_token?.data?.id);
    if (b) tokenAddrs.add(b);
    if (q) tokenAddrs.add(q);
  }
  const gtTokens = await tokensFetcher(gtNetwork, Array.from(tokenAddrs));
  const tokenMap = new Map<string, GtTokenData>();
  for (const t of gtTokens) {
    const addr = addressFromGtId(t.attributes.address) ?? web3Utils.toChecksumAddress(t.attributes.address);
    tokenMap.set(addr, mapGtToken(t));
  }

  const tallies: Record<string, number> = {};
  let pairs = 0;

  for (const p of pools) {
    const pairAddr = addressFromGtId(p.attributes.address) ?? (() => {
      try { return web3Utils.toChecksumAddress(p.attributes.address); } catch { return null; }
    })();
    const t0Addr = addressFromGtId(p.relationships.base_token?.data?.id);
    const t1Addr = addressFromGtId(p.relationships.quote_token?.data?.id);
    if (!pairAddr || !t0Addr || !t1Addr) {
      continue;
    }
    const gt0 = tokenMap.get(t0Addr);
    const gt1 = tokenMap.get(t1Addr);
    if (!gt0 || !gt1) {
      continue; // GT returned no token data — skip rather than write blanks
    }

    const poolCreatedAt = isoToUnix(p.attributes.pool_created_at);
    const token0Id = await upsertToken(chain, t0Addr, gt0, poolCreatedAt, now);
    const token1Id = await upsertToken(chain, t1Addr, gt1, poolCreatedAt, now);

    const pairId = await upsertPair(chain, dex, pairAddr, `${gt0.symbol}-${gt1.symbol}`, token0Id, token1Id, p, now);

    // The pair's CG (aggregated) prices come from the token-level price_usd.
    await prisma.pair.update({
      where: { id: pairId },
      data: { token0PriceCg: gt0.priceUsd, token1PriceCg: gt1.priceUsd },
    });

    const out = await runVerdictForPair(pairId);
    const key = out.skippedManual ? "skippedManual" : (out.result?.verdict ?? "error");
    tallies[key] = (tallies[key] ?? 0) + 1;
    pairs += 1;
  }

  return { hadData: true, pairs, tallies };
}
