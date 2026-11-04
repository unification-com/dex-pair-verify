// lib/latest.ts
// The /latest feed: the newest pairs and tokens together, ordered by when they were
// added or when their status last changed. Each kind fetches only its own newest
// `limit` rows (both timestamps are indexed) and the two lists are merged, so the
// feed stays two small queries however large the tables grow. Public visitors get
// the same verified-only, scam-free scope as /pairs and /tokens. The filters and
// row shape live in lib/latestFilters.ts (browser-safe).

import { Prisma } from "@prisma/client";

import { LatestFilters, LatestRow } from "./latestFilters";
import prisma from "./prisma";
import { publicPairListSelect, publicTokenListSelect } from "./publicSelect";
import { VERIFIED_STATUSES } from "./status";
import { TokenPairStatus } from "../types/types";

export async function latestEntities(f: LatestFilters, operator: boolean): Promise<LatestRow[]> {
  const field = f.order === "added" ? "createdAt" : "statusChangedAt";
  const shared = {
    // 0 = never stamped (a row from before the column, not yet backfilled).
    [field]: { gt: 0 },
    ...(f.chain ? { chain: f.chain } : {}),
    ...(operator ? {} : { status: { in: [...VERIFIED_STATUSES] } }),
  };
  const pairWhere: Prisma.PairWhereInput = { ...shared, ...(f.dex ? { dex: f.dex } : {}) };
  // A token matches a DEX filter when it has a pool on that DEX.
  const tokenWhere: Prisma.TokenWhereInput = {
    ...shared,
    ...(operator ? {} : { isScamFlagged: false }),
    ...(f.dex ? { OR: [{ pairsToken0: { some: { dex: f.dex } } }, { pairsToken1: { some: { dex: f.dex } } }] } : {}),
  };
  const orderBy = { [field]: "desc" as const };

  const [pairs, tokens] = await Promise.all([
    f.kind === "token" ? [] : prisma.pair.findMany({ where: pairWhere, select: { ...publicPairListSelect, statusChangedAt: true }, orderBy, take: f.limit }),
    f.kind === "pair"
      ? []
      : prisma.token.findMany({
          where: tokenWhere,
          select: { ...publicTokenListSelect, statusChangedAt: true, isScamFlagged: true, scamReason: true },
          orderBy,
          take: f.limit,
        }),
  ]);

  const rows: LatestRow[] = [
    ...pairs.map((p) => ({
      kind: "pair" as const,
      id: p.id,
      label: p.pair,
      detail: "",
      chain: p.chain,
      dex: p.dex,
      status: p.status as TokenPairStatus,
      scamFlagged: false,
      scamReason: "",
      reserveUsd: p.reserveUsd,
      at: p[field],
    })),
    ...tokens.map((t) => ({
      kind: "token" as const,
      id: t.id,
      label: t.symbol,
      detail: t.name,
      chain: t.chain,
      dex: null,
      status: t.status as TokenPairStatus,
      // Public rows are never flagged (filtered above), and the reason is operator-only.
      scamFlagged: t.isScamFlagged,
      scamReason: operator ? t.scamReason : "",
      reserveUsd: null,
      at: t[field],
    })),
  ];
  return rows.sort((a, b) => b.at - a.at).slice(0, f.limit);
}
