// lib/fulfilments.ts
// OoO fulfilment-history persistence + queries (admin dashboard #1). The fulfilment-watcher upserts the
// request side (DataRequested → pair + fee) and the fulfil side (RequestFulfilled → provider + result)
// independently, keyed by (chainId, router, requestId), so either event can arrive first / in a different
// scan batch. The admin list (and, later, the economics aggregates) read through here — so the DB shape and
// the BEACON-anchor join live in exactly one place.
import prisma from "./prisma";

import type { DataRequest, Fulfilment as DecodedFulfilment } from "../worker/fulfilment-watcher/receipt";

export const FULFILMENT_PAGE_SIZE = 50;

const refKeyOf = (chain: string, router: string, requestId: string): string => `${chain}/${router}/${requestId}`;
const compoundKey = (chainId: number, router: string, requestId: string) => ({
  chainId_router_requestId: { chainId, router, requestId },
});

// --- write side (watcher) ----------------------------------------------------------------------------

// Upsert the request side. Fills pair / fee / consumer / requestTx / requestBlock / requestedAt; never touches
// the fulfil-side fields, so it's order-independent vs the fulfilment event.
export async function upsertRequest(r: DataRequest, requestedAt: number | null, now: number): Promise<void> {
  const fields = {
    consumer: r.consumer,
    pair: r.pair,
    feePaid: r.feePaid,
    requestTxHash: r.txHash,
    requestBlock: r.blockNumber,
    ...(requestedAt != null ? { requestedAt } : {}),
  };
  await prisma.fulfilment.upsert({
    where: compoundKey(r.chainId, r.router, r.requestId),
    create: { chainId: r.chainId, chain: r.chain, router: r.router, requestId: r.requestId, ...fields, createdAt: now, updatedAt: now },
    update: { ...fields, updatedAt: now },
  });
}

// Upsert the fulfil side. Fills provider / result / fulfilTx / fulfilBlock / fulfilledAt; never touches the
// request-side fields.
export async function upsertFulfilment(f: DecodedFulfilment, fulfilledAt: number | null, now: number): Promise<void> {
  const result = f.requestedData && f.requestedData !== "0x" ? BigInt(f.requestedData).toString() : null;
  const fields = {
    consumer: f.consumer,
    provider: f.provider,
    result,
    fulfilTxHash: f.txHash,
    fulfilBlock: f.blockNumber,
    ...(fulfilledAt != null ? { fulfilledAt } : {}),
  };
  await prisma.fulfilment.upsert({
    where: compoundKey(f.chainId, f.router, f.requestId),
    create: { chainId: f.chainId, chain: f.chain, router: f.router, requestId: f.requestId, ...fields, createdAt: now, updatedAt: now },
    update: { ...fields, updatedAt: now },
  });
}

// --- read side (admin list + filters) ----------------------------------------------------------------

export type BeaconAnchorRef = { timestampId: number | null; txHash: string | null; metadata: string; anchoredAt: number | null };
export type FulfilmentRow = {
  id: number;
  chainId: number;
  chain: string;
  router: string;
  consumer: string | null;
  provider: string | null;
  requestId: string;
  pair: string | null;
  result: string | null;
  feePaid: string | null;
  requestTxHash: string | null;
  fulfilTxHash: string | null;
  requestedAt: number | null;
  fulfilledAt: number | null;
  beacon: BeaconAnchorRef | null;
};
export type FulfilmentFilters = { provider?: string | null; chainId?: number | null; pair?: string | null };
export type FulfilmentPage = {
  items: FulfilmentRow[];
  totalCount: number;
  page: number;
  totalPages: number;
  sort: string;
  dir: string;
};

// Whitelisted sort keys → prisma orderBy (so ?sort= can't inject a field). feePaid/result are uint256 strings,
// so they're deliberately NOT sortable here (lexical string order would mislead). Default: newest first.
function fulfilmentOrderBy(sort: string | null, dir: string | null) {
  const d: "asc" | "desc" = dir === "asc" ? "asc" : "desc";
  switch (sort) {
    case "pair": return { orderBy: [{ pair: d }], sortKey: "pair", sortDir: d };
    case "provider": return { orderBy: [{ provider: d }], sortKey: "provider", sortDir: d };
    case "chain": return { orderBy: [{ chain: d }], sortKey: "chain", sortDir: d };
    case "fulfilledAt": return { orderBy: [{ fulfilledAt: d }], sortKey: "fulfilledAt", sortDir: d };
    case "requestedAt": return { orderBy: [{ requestedAt: d }], sortKey: "requestedAt", sortDir: d };
    default: return { orderBy: [{ id: "desc" as const }], sortKey: "", sortDir: "" };
  }
}

// Fetch the BEACON anchor for each fulfilment by refKey (chain/router/requestId) — joined at read time rather
// than denormalised onto Fulfilment, so it can't drift.
async function beaconAnchorsByRefKey(refKeys: string[]): Promise<Map<string, BeaconAnchorRef>> {
  const m = new Map<string, BeaconAnchorRef>();
  if (refKeys.length === 0) return m;
  const rows = await prisma.beaconQueue.findMany({
    where: { stream: "fulfilment", refKey: { in: refKeys } },
    select: { refKey: true, timestampId: true, txHash: true, metadata: true, anchoredAt: true },
  });
  for (const r of rows) m.set(r.refKey, { timestampId: r.timestampId, txHash: r.txHash, metadata: r.metadata, anchoredAt: r.anchoredAt });
  return m;
}

export async function listFulfilments(opts: { filters: FulfilmentFilters; page: number; sort: string | null; dir: string | null }): Promise<FulfilmentPage> {
  const { orderBy, sortKey, sortDir } = fulfilmentOrderBy(opts.sort, opts.dir);
  const f = opts.filters;
  const where = {
    ...(f.chainId ? { chainId: f.chainId } : {}),
    ...(f.provider ? { provider: f.provider.toLowerCase() } : {}),
    ...(f.pair ? { pair: { contains: f.pair, mode: "insensitive" as const } } : {}),
  };
  const page = Math.max(1, opts.page);
  const [rows, totalCount] = await Promise.all([
    prisma.fulfilment.findMany({ where, orderBy, skip: (page - 1) * FULFILMENT_PAGE_SIZE, take: FULFILMENT_PAGE_SIZE }),
    prisma.fulfilment.count({ where }),
  ]);
  const anchors = await beaconAnchorsByRefKey(rows.map((r) => refKeyOf(r.chain, r.router, r.requestId)));
  const items: FulfilmentRow[] = rows.map((r) => ({
    id: r.id,
    chainId: r.chainId,
    chain: r.chain,
    router: r.router,
    consumer: r.consumer,
    provider: r.provider,
    requestId: r.requestId,
    pair: r.pair,
    result: r.result,
    feePaid: r.feePaid,
    requestTxHash: r.requestTxHash,
    fulfilTxHash: r.fulfilTxHash,
    requestedAt: r.requestedAt,
    fulfilledAt: r.fulfilledAt,
    beacon: anchors.get(refKeyOf(r.chain, r.router, r.requestId)) ?? null,
  }));
  return { items, totalCount, page, totalPages: Math.max(1, Math.ceil(totalCount / FULFILMENT_PAGE_SIZE)), sort: sortKey, dir: sortDir };
}

// Distinct providers + chains present in the table — populates the filter dropdowns.
export async function fulfilmentFilterOptions(): Promise<{ providers: string[]; chains: { chainId: number; chain: string }[] }> {
  const [provGroups, chainGroups] = await Promise.all([
    prisma.fulfilment.groupBy({ by: ["provider"], where: { provider: { not: null } } }),
    prisma.fulfilment.groupBy({ by: ["chainId", "chain"] }),
  ]);
  return {
    providers: provGroups.map((g) => g.provider).filter((p): p is string => !!p).sort(),
    chains: chainGroups.map((g) => ({ chainId: g.chainId, chain: g.chain })).sort((a, b) => a.chain.localeCompare(b.chain)),
  };
}
