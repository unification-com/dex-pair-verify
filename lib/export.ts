// Shared export builder (A.6). One implementation of the v2 export shape,
// reused by the session-gated GitHub-upload endpoint (pages/api/export.ts) and
// the bearer-token API endpoint (pages/api/export/[chain]/[dex].ts) so the two
// paths can never drift. Only verified pairs (operator-confirmed OR
// engine-auto-verified) are ever emitted — see VERIFIED_STATUSES.

import prisma from "./prisma";
import { VERIFIED_STATUSES } from "./status";

export const EXPORT_SCHEMA_VERSION = 2;

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
  token0: ExportTokenV2 | null;
  token1: ExportTokenV2 | null;
};

export type ExportV2 = {
  schemaVersion: number;
  generatedAt: number;
  chain: string;
  dex: string;
  pairs: ExportPairV2[];
};

const VERIFIED = [...VERIFIED_STATUSES];

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

// Build the v2 export for one (chain, dex): every verified pair, highest
// liquidity first, with its verdict + reason for downstream debugging.
export async function buildExportV2(
  chain: string,
  dex: string,
  opts: { now?: number } = {},
): Promise<ExportV2> {
  const data = await prisma.pair.findMany({
    where: { chain, dex, status: { in: VERIFIED } },
    include: {
      token0: { select: { chain: true, symbol: true, name: true, contractAddress: true } },
      token1: { select: { chain: true, symbol: true, name: true, contractAddress: true } },
    },
    orderBy: [{ reserveUsd: "desc" }],
  });

  const pairs: ExportPairV2[] = data.map((d) => ({
    contractAddress: d.contractAddress,
    pair: d.pair,
    reserveUsd: d.reserveUsd,
    volumeUsd: d.volumeUsd,
    txCount: d.txCount,
    verdict: d.status,
    verdictReason: d.verificationComment || "",
    token0: d.token0,
    token1: d.token1,
  }));

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    generatedAt: opts.now ?? nowSeconds(),
    chain,
    dex,
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
  const groups = await prisma.pair.groupBy({
    by: ["chain", "dex"],
    where: { status: { in: VERIFIED } },
    _count: { _all: true },
    _max: { lastChecked: true },
  });

  const byChain = new Map<string, ExportIndexDex[]>();
  for (const g of groups) {
    if (!byChain.has(g.chain)) {
      byChain.set(g.chain, []);
    }
    byChain.get(g.chain)!.push({
      dex: g.dex,
      url: `/api/export/${g.chain}/${g.dex}`,
      pairCount: g._count._all,
      lastUpdated: g._max.lastChecked ?? 0,
    });
  }

  const chains: ExportIndexChain[] = Array.from(byChain.entries()).map(([chain, dexs]) => ({
    chain,
    dexs,
  }));

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    generatedAt: opts.now ?? nowSeconds(),
    chains,
  };
}

// Max lastChecked across a (chain, dex)'s verified pairs — backs the
// ?ifModifiedSince= 304 short-circuit on the API endpoint.
export async function exportLastModified(chain: string, dex: string): Promise<number> {
  const agg = await prisma.pair.aggregate({
    where: { chain, dex, status: { in: VERIFIED } },
    _max: { lastChecked: true },
  });
  return agg._max.lastChecked ?? 0;
}
