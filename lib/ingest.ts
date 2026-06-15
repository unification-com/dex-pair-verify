// Source-agnostic ingest orchestrator (A.4.1, generalised in #128 Phase 2a). One pass per
// (chain, source) page: an IngestAdapter discovers + normalises pools/tokens, then the verdict runs
// inline. The adapter hides the transport + source shape (GeckoTerminal/EVM today — lib/gtAdapter.ts;
// a Cosmos SQS/Numia adapter slots in beside it), so this file owns only the source-neutral parts:
// upserting the normalised pool/token, running the verdict, and the per-(chain,dex) threshold floor.
// Precise on-chain reserves remain go-ooo's concern, not the verdict's.
//
// Two of the entry points below — the first-party token-pools spider and manual add-by-address — are
// GeckoTerminal features (they discover a token's pools / a pool by EVM address), so they speak to the
// GeckoTerminal adapter directly; the page ingest is fully adapter-driven and is the path a Cosmos
// source implements.

import { isCosmosRegistryChain } from "./cosmosRegistry";
import { gtAdapter, normaliseGtPage, defaultPoolByAddressFetcher, defaultTokenPoolsFetcher, PoolByAddressFetcher, PoolPageFetcher, TokenPoolsFetcher } from "./gtAdapter";
import { IngestAdapter, NormalisedPool, NormalisedToken, PoolFacts } from "./ingestAdapter";
import prisma from "./prisma";
import { getSource, getSources, gtDexFor, gtNetworkFor, thresholdSeedData } from "./sourceConfig";
import { sqsAdapter } from "./sqsAdapter";
import { poolAddressFromGt } from "./univ4";
import { runVerdictForPair } from "./verdictRunner";

const nowS = (): number => Math.floor(Date.now() / 1000);

// Pick the ingest adapter for a chain: the Osmosis SQS adapter for a Cosmos chain, the
// GeckoTerminal/EVM adapter otherwise. The only place the orchestrator needs to know more than one
// source transport exists (#128).
const adapterForChain = (chain: string): IngestAdapter => (isCosmosRegistryChain(chain) ? sqsAdapter : gtAdapter);

// --- source-neutral persistence ------------------------------------------

// Find-or-update a token from normalised source data. Never touches status /
// verificationMethod (those belong to the verdict/operator). deploymentTimestamp
// keeps the earliest pool_created_at seen.
async function upsertToken(
  chain: string,
  address: string,
  t: NormalisedToken,
  poolCreatedAt: number | null,
  now: number,
): Promise<string> {
  const existing = await prisma.token.findFirst({ where: { chain, contractAddress: address } });
  const common = {
    name: t.name,
    symbol: t.symbol,
    decimals: t.decimals,
    coingeckoCoinId: t.coingeckoCoinId,
    totalSupply: t.totalSupply,
    volume24hUsd: t.volume24hUsd,
    marketCapUsd: t.marketCapUsd,
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

// Find-or-update a pair from a normalised pool. Never touches the verdict
// columns (status / verificationMethod / canonicalKey / confidence / verdictAt)
// — runVerdictForPair owns those and runs right after.
async function upsertPair(
  chain: string,
  dex: string,
  address: string,
  pairSym: string,
  token0Id: string,
  token1Id: string,
  pool: NormalisedPool,
  now: number,
  hooks: string | null,
  subgraphPresent: boolean | null,
): Promise<string> {
  const common = {
    pair: pairSym,
    hooks,
    subgraphPresent,
    reserveUsd: pool.reserveUsd,
    reserve0: 0,
    reserve1: 0,
    reserveNativeCurrency: 0,
    volumeUsd: pool.volume24hUsd,
    volumeUsd24h: pool.volume24hUsd,
    marketCapUsd: pool.marketCapUsd,
    priceChangePercentage24h: pool.priceChange24h,
    buys24h: pool.buys24h,
    sells24h: pool.sells24h,
    buyers24h: pool.buyers24h,
    sellers24h: pool.sellers24h,
    txCount: pool.buys24h + pool.sells24h, // 24h activity proxy (GT gives no lifetime count)
    // token0 = base, token1 = quote. DEX price = this pool's USD price;
    // CG price = the token's aggregated price_usd (set on the token side).
    token0PriceDex: pool.baseTokenPriceUsd,
    token1PriceDex: pool.quoteTokenPriceUsd,
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

// Ingest ONE normalised pool into a (chain, dex): hydrate both tokens + the pair, set the pair's CG
// prices, run the verdict inline. Returns the verdict tally key, or null when the pool can't be
// ingested (a token whose data the source didn't supply). Source-agnostic — shared by every adapter's
// page ingest and the GeckoTerminal token-pools / manual-add paths (DRY).
async function ingestOnePool(
  chain: string,
  dex: string,
  pool: NormalisedPool,
  tokenMap: Map<string, NormalisedToken>,
  now: number,
  facts?: PoolFacts,
): Promise<string | null> {
  const idLower = pool.poolId.toLowerCase();
  // v4 hooks for this pool (null for non-v4 sources or an unresolved hooks fetch). Stored on the
  // pair so the verdict routes a hooked pool to NeedsReview (and re-verdicts stay correct).
  const hooks = facts?.hooks.get(idLower) ?? null;
  // Subgraph corroboration: only trust an ABSENCE when the page proved its id format aligns (≥1 of
  // its pools was found) — otherwise leave it unknown (null, fail-open) so a source whose ids we
  // can't line up is never demoted. true = the pricing surface indexes this pool; false = it's a
  // phantom go-ooo can never price → the verdict keeps it out of the export.
  const subgraphPresent = facts?.idsAlign ? facts.present.has(idLower) : null;

  const t0 = tokenMap.get(pool.baseAddress);
  const t1 = tokenMap.get(pool.quoteAddress);
  if (!t0 || !t1) {
    return null; // the source returned no token data — skip rather than write blanks
  }

  const token0Id = await upsertToken(chain, t0.address, t0, pool.poolCreatedAt, now);
  const token1Id = await upsertToken(chain, t1.address, t1, pool.poolCreatedAt, now);
  const pairId = await upsertPair(chain, dex, pool.poolId, `${t0.symbol}-${t1.symbol}`, token0Id, token1Id, pool, now, hooks, subgraphPresent);

  // The pair's CG (aggregated) prices come from the token-level price_usd.
  await prisma.pair.update({
    where: { id: pairId },
    data: { token0PriceCg: t0.priceUsd, token1PriceCg: t1.priceUsd },
  });

  const out = await runVerdictForPair(pairId);
  return out.skippedManual ? "skippedManual" : out.result?.verdict ?? "error";
}

// Ensure the per-(chain, dex) Threshold row exists so the verdict applies this
// source's tuned floors (liquidity + minTxCount) inline at ingest. Idempotent;
// creates once per source. Shared by page ingest, token-pools ingest and the
// manual add-by-address path (DRY).
async function ensureThreshold(chain: string, dex: string): Promise<void> {
  if (!(await prisma.threshold.findFirst({ where: { chain, dex } }))) {
    await prisma.threshold.create({ data: thresholdSeedData(chain, dex) });
  }
}

// --- page ingest (adapter-driven) ----------------------------------------

export type IngestPageResult = {
  hadData: boolean;
  poolCount: number;
  pairs: number;
  tallies: Record<string, number>;
};

// Ingest one source page for a (chain, dex): the adapter discovers + normalises + corroborates the
// page, then the verdict runs inline per pool. Returns whether the page had data (so the caller can
// stop paginating) and the verdict tally. `gtNetwork`/`gtDex`/`poolFetcher` are GeckoTerminal
// transport hints the EVM adapter reads (our internal chain/dex ids can differ from GeckoTerminal's
// slugs, e.g. bsc_pancakeswap_v3 vs pancakeswap-v3-bsc); a non-EVM adapter ignores them.
export async function ingestPoolPage(
  chain: string,
  dex: string,
  page: number,
  opts: {
    now?: number;
    poolFetcher?: PoolPageFetcher;
    gtNetwork?: string;
    gtDex?: string;
    // Cosmos (SQS) transport hints, read only by the SQS adapter.
    sqsUrl?: string;
    poolsFetcher?: unknown;
    pricesFetcher?: unknown;
  } = {},
): Promise<IngestPageResult> {
  const now = opts.now ?? nowS();

  await ensureThreshold(chain, dex);

  // A Cosmos source discovers pools from SQS bounded by its curation floor (the unfiltered pool set is
  // too large to fetch reliably); read the floor so discovery fetches exactly the eligible set.
  let minLiquidityCap = 0;
  if (isCosmosRegistryChain(chain)) {
    const threshold = await prisma.threshold.findFirst({ where: { chain, dex }, select: { minLiquidityUsd: true } });
    minLiquidityCap = threshold?.minLiquidityUsd ?? 0;
  }

  const adapter = adapterForChain(chain);
  const { poolCount, pools, tokens, facts } = await adapter.poolPage(chain, dex, page, {
    now,
    gtNetwork: opts.gtNetwork ?? chain,
    gtDex: opts.gtDex ?? dex,
    poolFetcher: opts.poolFetcher,
    sqsUrl: opts.sqsUrl,
    poolsFetcher: opts.poolsFetcher,
    pricesFetcher: opts.pricesFetcher,
    minLiquidityCap,
  });
  if (poolCount === 0) {
    return { hadData: false, poolCount: 0, pairs: 0, tallies: {} };
  }

  const tallies: Record<string, number> = {};
  let pairs = 0;
  for (const p of pools) {
    const key = await ingestOnePool(chain, dex, p, tokens, now, facts);
    if (key === null) {
      continue;
    }
    tallies[key] = (tallies[key] ?? 0) + 1;
    pairs += 1;
  }

  return { hadData: true, poolCount, pairs, tallies };
}

// --- token-pools ingest (all of a token's pools across DEXs) --------------

export type TokenPoolsIngestResult = { ingested: number; skipped: number; tallies: Record<string, number> };

// Fetch every supported-DEX pool for a token on a chain and ingest each (verdict
// inline). The page ingest only takes the top-ranked pools per DEX, so this is how
// a specific token's pools land in the DB. Used by the first-party ingest pass (our
// own tokens), by manual token-add and by the cross-chain spider. A pool on a DEX
// with no SupportedSource is skipped (no subgraph → not exportable to go-ooo). This
// is a GeckoTerminal feature (it discovers a token's pools across DEXs), so it drives
// the GeckoTerminal adapter directly.
export async function ingestTokenPools(
  chain: string,
  address: string,
  opts: { now?: number; fetcher?: TokenPoolsFetcher } = {},
): Promise<TokenPoolsIngestResult> {
  const now = opts.now ?? nowS();
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

  const { pools: gtPools, tokens: gtTokens } = await fetcher(gtNetwork, address);
  const { pools, tokens } = normaliseGtPage(chain, gtPools, gtTokens);

  const tallies: Record<string, number> = {};
  let ingested = 0;
  for (const pool of pools) {
    const dex = pool.dexId ? dexByGtSlug.get(pool.dexId) : undefined;
    if (!dex) {
      continue; // pool on a DEX we don't support — can't export it
    }
    // Pools here can span several DEXs, so corroborate per pool (presence + univ4 hooks).
    const facts = await gtAdapter.corroborate(chain, dex, [pool]);
    const key = await ingestOnePool(chain, dex, pool, tokens, now, facts);
    if (key === null) {
      continue;
    }
    tallies[key] = (tallies[key] ?? 0) + 1;
    ingested += 1;
  }
  // Every fetched pool is either ingested or skipped (unsupported DEX, missing token data, or an
  // unresolvable id dropped in normalisation), so skipped is the remainder of the raw page.
  return { ingested, skipped: gtPools.length - ingested, tallies };
}

// --- manual add by pool address ------------------------------------------

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
// the data is incomplete. A GeckoTerminal feature (lookup by EVM pool address).
export async function ingestPairByAddress(
  chain: string,
  dex: string,
  address: string,
  opts: { now?: number; fetcher?: PoolByAddressFetcher } = {},
): Promise<AddPairByAddressResult> {
  const now = opts.now ?? nowS();
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
  const { pool, tokens: gtTokens } = await fetcher(gtNetwork, poolAddr);
  if (!pool) {
    return { ok: false, reason: `GeckoTerminal has no pool ${poolAddr} on ${gtNetwork}` };
  }

  const { pools, tokens } = normaliseGtPage(chain, [pool], gtTokens);
  const norm = pools[0];

  // Guard: the pool must actually be on the selected DEX (GT tags each pool's dex).
  if (norm?.dexId && norm.dexId !== gtDex) {
    return { ok: false, reason: `pool is on '${norm.dexId}', not '${gtDex}' — pick the matching DEX` };
  }

  if (!norm) {
    return { ok: false, reason: "GeckoTerminal returned incomplete pool/token data" };
  }

  const facts = await gtAdapter.corroborate(chain, dex, [norm]);
  const verdict = await ingestOnePool(chain, dex, norm, tokens, now, facts);
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
