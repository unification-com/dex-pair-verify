// lib/latestFilters.ts
// The /latest feed's filters and row shape. Kept free of Prisma so the page can
// import them into the browser bundle; the query itself is lib/latest.ts.

import { cleanParam } from "./queryParams";
import { TokenPairStatus } from "../types/types";

export const LATEST_KINDS = ["pair", "token"] as const;
export type LatestKind = (typeof LATEST_KINDS)[number];

// added = createdAt, changed = statusChangedAt.
export const LATEST_ORDERS = ["added", "changed"] as const;
export type LatestOrder = (typeof LATEST_ORDERS)[number];

export const LATEST_LIMITS = [20, 50] as const;
export const DEFAULT_LATEST_LIMIT = 50;

export type LatestFilters = {
  kind: LatestKind | null;
  chain: string | null;
  dex: string | null;
  order: LatestOrder;
  limit: number;
};

export type LatestRow = {
  kind: LatestKind;
  id: string;
  label: string; // pair name / token symbol
  detail: string; // token name ("" for a pair)
  chain: string;
  dex: string | null;
  status: TokenPairStatus;
  scamFlagged: boolean;
  scamReason: string;
  reserveUsd: number | null; // pairs only
  at: number; // the timestamp the feed is ordered by
};

const oneOf = <T extends string>(allowed: readonly T[], v: string | null): T | null =>
  v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : null;

// The feed's query string, whitelisted (an unknown type/order/limit falls back to the default).
export function parseLatestFilters(query: Record<string, unknown>): LatestFilters {
  const limit = Number(cleanParam(query.limit));
  return {
    kind: oneOf(LATEST_KINDS, cleanParam(query.type)),
    chain: cleanParam(query.chain),
    dex: cleanParam(query.dex),
    order: oneOf(LATEST_ORDERS, cleanParam(query.order)) ?? "added",
    limit: (LATEST_LIMITS as readonly number[]).includes(limit) ? limit : DEFAULT_LATEST_LIMIT,
  };
}
