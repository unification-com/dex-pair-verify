// Shared export builder (A.6). One implementation of the export shape, reused by
// the session-gated GitHub-upload endpoint (pages/api/export.ts) and the
// bearer-token API endpoint (pages/api/export/[chain]/[dex].ts) so the two paths
// can never drift. Only verified pairs (operator-confirmed OR engine-auto-
// verified) are ever emitted — see VERIFIED_STATUSES.

import { Prisma } from "@prisma/client";

import prisma from "./prisma";
import { VERIFIED_STATUSES } from "./status";
import { TokenPairStatus } from "../types/types";

// The pair-export wire format. Bumped to 3 (T5 / XR1): adds a per-pair trust
// score (confidence) + canonicalKey, and the per-(chain,dex) curation floor, so
// go-ooo can weight pools by trust. Additive — a v2 consumer ignores the new
// fields.
export const EXPORT_PAIR_SCHEMA_VERSION = 3;
// The discovery manifest format — still 2. Phase 4 evolves it to 3 with the
// richer per-source metadata (see TRACKER-modular-dex-network.md § 4.C).
export const EXPORT_MANIFEST_SCHEMA_VERSION = 2;

export type ExportTokenV2 = {
  chain: string;
  symbol: string;
  name: string;
  contractAddress: string;
};

export type ExportPairV2 = {
  contractAddress: string;
  pair: string;
  reserveUsd: number;
  volumeUsd: number;
  txCount: number;
  verdict: string;
  verdictReason: string;
  // Trust score in [0,1] for go-ooo to weight this pool by (XR1). A
  // ManualVerified pair is operator-vouched → 1; an AutoVerified pair carries
  // the verdict engine's weighted-fence confidence.
  confidence: number;
  // Cross-source grouping key (min:max of the two CoinGecko coin ids) so go-ooo
  // can recognise the same logical pair across chains/DEXs. null when unkeyable.
  canonicalKey: string | null;
  token0: ExportTokenV2 | null;
  token1: ExportTokenV2 | null;
};

export type ExportV2 = {
  schemaVersion: number;
  generatedAt: number;
  chain: string;
  dex: string;
  // The per-(chain,dex) curation soft floor go-ooo should honour as the single
  // source of truth for pair eligibility (XR2), rather than re-filtering on its
  // own MinReserveUsd.
  minLiquidityUsd: number;
  pairs: ExportPairV2[];
};

const VERIFIED = [...VERIFIED_STATUSES];

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// The "anything changed" timestamp for a set of pairs: the later of any verdict
// transition (verdictAt — bumps on promote AND demote) or re-ingest
// (lastChecked). Aggregated over ALL pairs in scope, not just verified, so a
// DEMOTION still advances the signal — the demoted pair carries the change
// timestamp but is no longer verified, so a verified-only max would miss it and
// a polling go-ooo would keep serving the delisted pair on a stale 304.
const pairsModifiedAt = async (where: Prisma.PairWhereInput): Promise<number> => {
  const agg = await prisma.pair.aggregate({ where, _max: { lastChecked: true, verdictAt: true } });
  return Math.max(agg._max.lastChecked ?? 0, agg._max.verdictAt ?? 0);
};

// The export-ready trust score: operator-vouched pairs are max trust; otherwise
// the engine confidence (null → 0, e.g. a legacy verified pair never re-run).
const trustScore = (status: string, confidence: number | null): number =>
  status === TokenPairStatus.ManualVerified ? 1 : round4(confidence ?? 0);

// Build the export for one (chain, dex): every verified pair, highest liquidity
// first, with its verdict + reason + trust score for downstream weighting.
export async function buildExportV2(
  chain: string,
  dex: string,
  opts: { now?: number } = {},
): Promise<ExportV2> {
  const [data, threshold] = await Promise.all([
    prisma.pair.findMany({
      where: { chain, dex, status: { in: VERIFIED } },
      include: {
        token0: { select: { chain: true, symbol: true, name: true, contractAddress: true } },
        token1: { select: { chain: true, symbol: true, name: true, contractAddress: true } },
      },
      orderBy: [{ reserveUsd: "desc" }],
    }),
    prisma.threshold.findFirst({ where: { chain, dex } }),
  ]);

  const pairs: ExportPairV2[] = data.map((d) => ({
    contractAddress: d.contractAddress,
    pair: d.pair,
    reserveUsd: d.reserveUsd,
    volumeUsd: d.volumeUsd,
    txCount: d.txCount,
    verdict: d.status,
    verdictReason: d.verificationComment || "",
    confidence: trustScore(d.status, d.confidence),
    canonicalKey: d.canonicalKey,
    token0: d.token0,
    token1: d.token1,
  }));

  return {
    schemaVersion: EXPORT_PAIR_SCHEMA_VERSION,
    generatedAt: opts.now ?? nowSeconds(),
    chain,
    dex,
    minLiquidityUsd: threshold?.minLiquidityUsd ?? 0,
    pairs,
  };
}

export type ExportIndexDex = { dex: string; url: string; pairCount: number; lastUpdated: number };
export type ExportIndexChain = { chain: string; dexs: ExportIndexDex[] };
export type ExportIndex = {
  schemaVersion: number;
  generatedAt: number;
  chains: ExportIndexChain[];
};

// The discovery manifest (A.6.2): which (chain, dex) exports exist, their pair
// counts + last-updated, so go-ooo can poll without a hardcoded source list.
export async function buildExportIndex(opts: { now?: number } = {}): Promise<ExportIndex> {
  const [verifiedGroups, modifiedGroups] = await Promise.all([
    prisma.pair.groupBy({
      by: ["chain", "dex"],
      where: { status: { in: VERIFIED } },
      _count: { _all: true },
    }),
    // Modified-time over ALL pairs (see pairsModifiedAt) so a demotion counts.
    prisma.pair.groupBy({
      by: ["chain", "dex"],
      _max: { lastChecked: true, verdictAt: true },
    }),
  ]);

  const modifiedAt = new Map<string, number>();
  for (const g of modifiedGroups) {
    modifiedAt.set(`${g.chain}/${g.dex}`, Math.max(g._max.lastChecked ?? 0, g._max.verdictAt ?? 0));
  }

  const byChain = new Map<string, ExportIndexDex[]>();
  for (const g of verifiedGroups) {
    if (!byChain.has(g.chain)) {
      byChain.set(g.chain, []);
    }
    byChain.get(g.chain)!.push({
      dex: g.dex,
      url: `/api/export/${g.chain}/${g.dex}`,
      pairCount: g._count._all,
      lastUpdated: modifiedAt.get(`${g.chain}/${g.dex}`) ?? 0,
    });
  }

  const chains: ExportIndexChain[] = Array.from(byChain.entries()).map(([chain, dexs]) => ({
    chain,
    dexs,
  }));

  return {
    schemaVersion: EXPORT_MANIFEST_SCHEMA_VERSION,
    generatedAt: opts.now ?? nowSeconds(),
    chains,
  };
}

// The (chain, dex)'s last-modified time — backs the ?ifModifiedSince= 304
// short-circuit on the API endpoint. Over ALL pairs (not just verified) so a
// promotion OR demotion advances it (see pairsModifiedAt); a verified-only max
// would let go-ooo 304 past a pair we just demoted and keep trusting it.
export async function exportLastModified(chain: string, dex: string): Promise<number> {
  return pairsModifiedAt({ chain, dex });
}

// --- Public supported-pairs catalogue (T10) ------------------------------
//
// The PUBLIC, ungated "menu" of pairs an OoO user can query (e.g. WETH.USDC.AD)
// — distinct from the gated provider feeds (buildExportV2 / buildExportIndex).
// Carries NO trust internals (per-pool confidence, verdict reasons, contract
// addresses, the curation floor) — only what's queryable, deduped by canonical
// key across chains/DEXs. Safe to expose; cacheable.

export const PUBLIC_CATALOGUE_SCHEMA_VERSION = 1;
const CATALOGUE_QUERY_FORMAT = "BASE.TARGET.AD";

export type PublicPairEntry = {
  base: string; // symbols a user queries with (canonical order; queryable either way)
  target: string;
  canonicalKey: string | null; // cross-source group key; null for unkeyable (no-cgId) pairs
  sources: number; // number of verified pools backing it
  chains: string[]; // distinct chains it's available on
  totalLiquidityUsd: number; // aggregate backing depth (a public reliability hint)
};

export type PublicCatalogue = {
  schemaVersion: number;
  generatedAt: number;
  queryFormat: string;
  pairs: PublicPairEntry[];
};

const cgNorm = (id: string | null | undefined): string => (id ?? "").trim().toLowerCase();

// Build the public catalogue: every verified pair, grouped to one entry per
// logical pair. Keyed pairs group by canonicalKey (so the same pair across
// chains/DEXs collapses to one row); unkeyable verified pairs (no cgId) fall back
// to grouping by their symbol pair so they still appear (no silent drop). Deepest
// liquidity first.
export async function buildPublicPairsCatalogue(opts: { now?: number } = {}): Promise<PublicCatalogue> {
  const rows = await prisma.pair.findMany({
    where: { status: { in: VERIFIED } },
    select: {
      chain: true,
      reserveUsd: true,
      canonicalKey: true,
      token0: { select: { symbol: true, coingeckoCoinId: true } },
      token1: { select: { symbol: true, coingeckoCoinId: true } },
    },
  });

  type Group = {
    base: string;
    target: string;
    canonicalKey: string | null;
    chains: Set<string>;
    sources: number;
    totalLiquidityUsd: number;
  };
  const groups = new Map<string, Group>();

  for (const r of rows) {
    let groupKey: string;
    let base: string;
    let target: string;
    if (r.canonicalKey) {
      // base = the token whose cgId is the FIRST half of the key (the canonical
      // key is "cgIdA:cgIdB", sorted; cgIds never contain ":"). Deterministic, so
      // every pool in the group resolves the same base/target.
      const cgA = r.canonicalKey.split(":")[0];
      const t0First = cgNorm(r.token0.coingeckoCoinId) === cgA;
      base = t0First ? r.token0.symbol : r.token1.symbol;
      target = t0First ? r.token1.symbol : r.token0.symbol;
      groupKey = r.canonicalKey;
    } else {
      // No cgId → group by the order-independent symbol pair.
      base = r.token0.symbol;
      target = r.token1.symbol;
      groupKey = `sym:${[base.toLowerCase(), target.toLowerCase()].sort().join("|")}`;
    }

    let g = groups.get(groupKey);
    if (!g) {
      g = { base, target, canonicalKey: r.canonicalKey, chains: new Set(), sources: 0, totalLiquidityUsd: 0 };
      groups.set(groupKey, g);
    }
    g.chains.add(r.chain);
    g.sources += 1;
    g.totalLiquidityUsd += r.reserveUsd;
  }

  const pairs: PublicPairEntry[] = Array.from(groups.values())
    .map((g) => ({
      base: g.base,
      target: g.target,
      canonicalKey: g.canonicalKey,
      sources: g.sources,
      chains: Array.from(g.chains).sort(),
      totalLiquidityUsd: Math.round(g.totalLiquidityUsd),
    }))
    .sort((a, b) => b.totalLiquidityUsd - a.totalLiquidityUsd);

  return {
    schemaVersion: PUBLIC_CATALOGUE_SCHEMA_VERSION,
    generatedAt: opts.now ?? nowSeconds(),
    queryFormat: CATALOGUE_QUERY_FORMAT,
    pairs,
  };
}

// Last-modified for the public catalogue — any verdict change anywhere can add or
// remove a verified pair, so it's the max over ALL pairs (see pairsModifiedAt).
export async function publicCatalogueLastModified(): Promise<number> {
  return pairsModifiedAt({});
}
