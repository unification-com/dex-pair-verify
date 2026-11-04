// Shared threshold-map builder for the OoO price-simulation pages.
//
// Replaces the per-pair `prisma.threshold.findFirst` loop (the B7 N+1) with a
// single `findMany` over the distinct (chain, dex) tuples in the pair set.

import prisma from "./prisma";

export type ThresholdEntry = {
  id: string;
  minReserveUsd: number;
  minTxCount: number;
};

export type ThresholdMap = Record<string, Record<string, ThresholdEntry>>;

type ChainDex = { chain: string; dex: string };

export async function buildThresholdMap(
  pairs: { chain: string; dex: string }[],
): Promise<ThresholdMap> {
  const seen = new Set<string>();
  const distinct: ChainDex[] = [];
  for (const p of pairs) {
    const key = `${p.chain}:${p.dex}`;
    if (!seen.has(key)) {
      seen.add(key);
      distinct.push({ chain: p.chain, dex: p.dex });
    }
  }

  if (distinct.length === 0) {
    return {};
  }

  const rows = await prisma.threshold.findMany({
    where: { OR: distinct },
  });

  const map: ThresholdMap = {};
  for (const t of rows) {
    if (map[t.chain] === undefined) {
      map[t.chain] = {};
    }
    map[t.chain][t.dex] = {
      id: t.id,
      minReserveUsd: t.minLiquidityUsd,
      minTxCount: t.minTxCount,
    };
  }
  return map;
}
