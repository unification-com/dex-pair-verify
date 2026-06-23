import { GetServerSideProps } from "next"
import Link from "next/link";
import { useRouter } from "next/router";
import React, { useEffect, useState } from "react"
import { NotificationManager } from 'react-notifications';

import ChainName from "../components/ChainName";
import DexName from "../components/DexName";
import Pagination from "../components/Pagination";
import Layout from "../components/shell/Layout"
import ConfidenceMeter from "../components/ui/ConfidenceMeter";
import DataTable, { Column } from "../components/ui/DataTable";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import SearchBox from "../components/ui/SearchBox";
import StatusBadge from "../components/ui/StatusBadge";
import { priceableSourceMeta, poolIsPriceable } from "../lib/export";
import { usd, num } from "../lib/format";
import { isOperatorCtx } from "../lib/operatorGate";
import prisma from '../lib/prisma';
import { publicPairListSelect } from "../lib/publicSelect";
import { cleanParam, pageParam } from "../lib/queryParams";
import { coerceStatus, VERIFIED_STATUSES } from "../lib/status";
import { PairProps } from "../types/props";
import { TokenPairStatus } from "../types/types";

const PAGE_SIZE = 50

// Tab order for the pair queue. Needs Review is the operator's working queue
// (the shrunken manual bucket), so it leads and is the default landing tab.
const PAIR_TABS: { status: TokenPairStatus; label: string }[] = [
    { status: TokenPairStatus.NeedsReview, label: "Needs Review" },
    { status: TokenPairStatus.AutoVerified, label: "Auto-Verified" },
    { status: TokenPairStatus.ManualVerified, label: "Verified" },
    { status: TokenPairStatus.AutoRejected, label: "Auto-Rejected" },
    { status: TokenPairStatus.Unverified, label: "Unverified" },
    { status: TokenPairStatus.Duplicate, label: "Duplicate" },
    { status: TokenPairStatus.NotCurrentlyUsable, label: "Not Usable" },
]

type Source = { chain: string; dex: string };

// Whitelisted sortable columns → a prisma orderBy (so the ?sort= param can't inject
// a field) + the normalised key/dir that drives the header indicator. Sorting runs
// in the DB across the WHOLE result set, then we paginate — not just this page.
function pairSort(sort: string | null, dir: string | null) {
  const d: "asc" | "desc" = dir === "asc" ? "asc" : "desc";
  switch (sort) {
    case "pair": return { orderBy: [{ pair: d }], sortKey: "pair", sortDir: d };
    case "reserveUsd": return { orderBy: [{ reserveUsd: d }], sortKey: "reserveUsd", sortDir: d };
    case "txCount": return { orderBy: [{ txCount: d }], sortKey: "txCount", sortDir: d };
    case "confidence": return { orderBy: [{ confidence: d }], sortKey: "confidence", sortDir: d };
    case "reviewTier": return { orderBy: [{ reviewTier: d }], sortKey: "reviewTier", sortDir: d };
    default: return { orderBy: [{ reserveNativeCurrency: "desc" as const }], sortKey: "", sortDir: "" };
  }
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const operator = await isOperatorCtx(ctx);
  const { query } = ctx;
  // U-Q1: chain/dex are OPTIONAL filters. Absent → the whole queue.
  const chain = cleanParam(query?.chain)
  const dex = cleanParam(query?.dex)
  const q = cleanParam(query?.q)
  const page = pageParam(query?.page)
  const { orderBy, sortKey, sortDir } = pairSort(cleanParam(query?.sort), cleanParam(query?.dir))
  // Whole-dataset text search on the pair name (server-side, so it's not limited
  // to the current page). Postgres case-insensitive contains.
  const search = q ? { pair: { contains: q, mode: "insensitive" as const } } : {}

  // Public visitors get a read-only listing of VERIFIED pairs only — no review
  // queue, no triage, no confidence/driver internals, no actions.
  if (!operator) {
    const where = {
      status: { in: [...VERIFIED_STATUSES] },
      ...(chain ? { chain } : {}),
      ...(dex ? { dex } : {}),
      ...search,
    }
    const [pairs, totalCount, sourceGroups, priceableMeta] = await Promise.all([
      prisma.pair.findMany({
        where,
        // Public list: explicit select (no verdict drivers / token internals).
        select: publicPairListSelect,
        orderBy,
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.pair.count({ where }),
      prisma.pair.groupBy({ by: ['chain', 'dex'], where: { status: { in: [...VERIFIED_STATUSES] } }, _count: { _all: true } }),
      // go-ooo's recognised price sources + their per-pool liquidity floor — drives the
      // per-row "OoO pricing" badge. Same helper the public /api/ooo/v1/pairs catalogue
      // derives its priceable flag from (one definition of go-ooo priceability).
      priceableSourceMeta(),
    ])
    const chains = Array.from(new Set(sourceGroups.map((g) => g.chain))).sort()
    const sources: Source[] = sourceGroups.map((g) => ({ chain: g.chain, dex: g.dex }))
    // A pair is priceable if go-ooo prices its source AND this pool clears that source's floor.
    const priceablePairIds = pairs.filter((p) => poolIsPriceable(priceableMeta, p.chain, p.dex, p.reserveUsd)).map((p) => p.id)
    return {
      props: {
        isOperator: false,
        pairs,
        chain: chain ?? "",
        dex: dex ?? "",
        q: q ?? "",
        page,
        totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
        totalCount,
        chains,
        sources,
        priceablePairIds,
        sort: sortKey,
        dir: sortDir,
      },
    }
  }

    const qStatus = coerceStatus(query?.status, TokenPairStatus.NeedsReview)
    const tier = qStatus === TokenPairStatus.NeedsReview && query?.tier ? String(query.tier) : undefined

    const scope: Record<string, string> = {}
    if (chain) scope.chain = chain
    if (dex) scope.dex = dex
    const where = { ...scope, status: qStatus, ...(tier ? { reviewTier: tier } : {}), ...search }

    const [pairs, totalCount, statusGroups, tierGroups, thresholdRows, sourceGroups] = await Promise.all([
        prisma.pair.findMany({
            where,
            include: {
                token0: { select: { symbol: true, id: true, status: true } },
                token1: { select: { symbol: true, id: true, status: true } },
                _count: { select: { duplicatePairs: true } },
            },
            orderBy,
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE,
        }),
        prisma.pair.count({ where }),
        prisma.pair.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
        prisma.pair.groupBy({ by: ['reviewTier'], where: { ...scope, status: TokenPairStatus.NeedsReview }, _count: { _all: true } }),
        prisma.threshold.findMany({ select: { chain: true, dex: true, minLiquidityUsd: true } }),
        prisma.pair.groupBy({ by: ['chain', 'dex'], _count: { _all: true } }),
    ]);

    const statusCounts: Record<string, number> = {}
    for (const g of statusGroups) statusCounts[g.status] = g._count._all

    const tierCounts: Record<string, number> = {}
    for (const g of tierGroups) if (g.reviewTier) tierCounts[g.reviewTier] = g._count._all

    const floorMap: Record<string, Record<string, number>> = {}
    for (const t of thresholdRows) (floorMap[t.chain] ||= {})[t.dex] = t.minLiquidityUsd

    const chains = Array.from(new Set(sourceGroups.map((g) => g.chain))).sort()
    const sources: Source[] = sourceGroups.map((g) => ({ chain: g.chain, dex: g.dex }))

    return {
        props: {
            isOperator: true,
            pairs,
            chain: chain ?? "",
            dex: dex ?? "",
            q: q ?? "",
            status: qStatus,
            tier: tier ?? "",
            page,
            totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
            totalCount,
            statusCounts,
            tierCounts,
            floorMap,
            chains,
            sources,
            sort: sortKey,
            dir: sortDir,
        },
    };
}

type OperatorProps = {
    isOperator: true,
    pairs: PairProps[],
    chain: string,
    dex: string,
    q: string,
    status: TokenPairStatus,
    tier: string,
    page: number,
    totalPages: number,
    totalCount: number,
    statusCounts: Record<string, number>,
    tierCounts: Record<string, number>,
    floorMap: Record<string, Record<string, number>>,
    chains: string[],
    sources: Source[],
    sort: string,
    dir: string,
}
type PublicProps = {
    isOperator: false,
    pairs: PairProps[],
    chain: string,
    dex: string,
    q: string,
    page: number,
    totalPages: number,
    totalCount: number,
    chains: string[],
    sources: Source[],
    priceablePairIds: string[], // ids of this page's pairs go-ooo will price (source + per-pool floor)
    sort: string,
    dir: string,
}
type Props = OperatorProps | PublicProps;

const TriageBadge: React.FC<{ tier: string | null }> = ({ tier }) =>
    tier === "spam" ? <span className="badge badge-fail badge-sm">Likely spam</span>
        : tier === "review" ? <span className="badge badge-warn badge-sm">Worth a look</span>
            : <span className="muted">—</span>;

// Public read-only listing of verified pairs.
const PublicPairs: React.FC<PublicProps> = (props) => {
    const router = useRouter()

    const hrefWith = (over: Partial<{ chain: string; dex: string; q: string; page: number; sort: string; dir: string }>): string => {
        const qs = new URLSearchParams()
        const chain = over.chain ?? props.chain
        const dex = over.dex ?? props.dex
        const q = over.q ?? props.q
        const sort = over.sort ?? props.sort
        const dir = over.dir ?? props.dir
        if (chain) qs.set("chain", chain)
        if (dex) qs.set("dex", dex)
        if (q) qs.set("q", q)
        if (sort) { qs.set("sort", sort); if (dir) qs.set("dir", dir) }
        if (over.page && over.page > 1) qs.set("page", String(over.page))
        const s = qs.toString()
        return s ? `/pairs?${s}` : "/pairs"
    }

    // Pairs go-ooo will likely price (computed server-side: recognised source + the pool
    // clears its liquidity floor). Flagged "Priceable" so a user can tell apart "verified"
    // from "go-ooo will likely return a price". Best-effort — go-ooo re-checks live liquidity.
    const priceableIds = new Set(props.priceablePairIds)

    const cols: Column<PairProps>[] = [
        {
            key: "pair", label: "Pair", sortable: true, render: (p) => (
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 600 }}>{p.pair}</span>
                    <span className="muted" style={{ fontSize: "var(--fs-xs)" }}><ChainName chain={p.chain} /> · <DexName dex={p.dex} /></span>
                </div>
            ),
        },
        { key: "reserveUsd", label: "Liquidity", num: true, sortable: true, render: (p) => usd(p.reserveUsd) },
        { key: "txCount", label: "Tx", num: true, sortable: true, render: (p) => num(p.txCount) },
        { key: "status", label: "Status", render: (p) => <StatusBadge status={p.status} size="sm" /> },
        {
            key: "priceable", label: "OoO pricing", render: (p) => priceableIds.has(p.id)
                ? <span className="badge badge-pass badge-sm">Priceable</span>
                : <span className="badge badge-neutral badge-sm">Not priced</span>,
        },
    ]

    return (
        <Layout crumb="Verified pairs">
            <PageHeader
                title="Verified pairs"
                sub={`${props.totalCount} verified DEX pairs feeding OoO${props.chain || props.dex ? " · filtered" : " · all sources"}`}
            />

            <div className="filters card card-pad">
                <SearchBox value={props.q} placeholder="Search pairs by name…" onSearch={(q) => router.push(hrefWith({ q, page: 1 }))} />
                <select className="input" value={props.chain} onChange={(e) => router.push(hrefWith({ chain: e.target.value, dex: "", page: 1 }))}>
                    <option value="">All chains</option>
                    {props.chains.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="input" value={props.dex} onChange={(e) => router.push(hrefWith({ dex: e.target.value, page: 1 }))}>
                    <option value="">All DEXs</option>
                    {props.sources.filter((s) => !props.chain || s.chain === props.chain).map((s) => <option key={`${s.chain}_${s.dex}`} value={s.dex}>{s.dex}{props.chain ? "" : ` (${s.chain})`}</option>)}
                </select>
            </div>

            <DataTable
                columns={cols}
                data={props.pairs}
                rowKey={(p) => p.id}
                onRowClick={(p) => router.push(`/p/${p.id}`)}
                serverSort={props.sort ? { key: props.sort, dir: props.dir === "asc" ? "asc" : "desc" } : null}
                onSortChange={(key, d) => router.push(hrefWith({ sort: key, dir: d, page: 1 }))}
                empty="No verified pairs in this view."
            />

            <Pagination page={props.page} totalPages={props.totalPages} makeHref={(p) => hrefWith({ page: p })} />

            <style jsx>{`
                .filters { display: flex; gap: var(--sp-4); align-items: center; margin-bottom: var(--sp-4); flex-wrap: wrap; }
                .ico-input { position: relative; display: inline-flex; align-items: center; flex: 1; min-width: 220px; }
                .ico-input :global(.ico) { position: absolute; left: 10px; color: var(--text-2); }
                .ico-input .input { width: 100%; padding-left: 30px; }
            `}</style>
        </Layout>
    )
}

const OperatorPairs: React.FC<OperatorProps> = (props) => {
    const router = useRouter()
    const [selected, setSelected] = useState<Set<string>>(new Set())

    // Clear selection whenever the route (filters / page / search) changes.
    useEffect(() => { setSelected(new Set()) }, [props.chain, props.dex, props.status, props.tier, props.q, props.page])

    // Build a /pairs href, carrying the active filter and overriding parts.
    const hrefWith = (over: Partial<{ status: string; chain: string; dex: string; q: string; tier: string; page: number; sort: string; dir: string }>): string => {
        const qs = new URLSearchParams()
        const status = over.status ?? props.status
        const chain = over.chain ?? props.chain
        const dex = over.dex ?? props.dex
        const q = over.q ?? props.q
        const tier = over.tier ?? (over.status && over.status !== props.status ? "" : props.tier)
        const sort = over.sort ?? props.sort
        const dir = over.dir ?? props.dir
        qs.set("status", status)
        if (chain) qs.set("chain", chain)
        if (dex) qs.set("dex", dex)
        if (q) qs.set("q", q)
        if (tier) qs.set("tier", tier)
        if (sort) { qs.set("sort", sort); if (dir) qs.set("dir", dir) }
        if (over.page && over.page > 1) qs.set("page", String(over.page))
        return `/pairs?${qs.toString()}`
    }
    // Filter the pair-detail link carries (so QueueNav can walk this same queue).
    const detailQs = (() => {
        const qs = new URLSearchParams()
        qs.set("status", props.status)
        if (props.chain) qs.set("chain", props.chain)
        if (props.dex) qs.set("dex", props.dex)
        if (props.q) qs.set("q", props.q)
        if (props.tier) qs.set("tier", props.tier)
        return qs.toString()
    })()

    const toggleSelected = (id: string) => setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
    })
    const toggleAll = (allSel: boolean) => setSelected((prev) => {
        const next = new Set(prev)
        for (const p of props.pairs) { if (allSel) next.delete(p.id); else next.add(p.id) }
        return next
    })

    async function bulkAction(action: "approve" | "reject" | "rescan") {
        if (selected.size === 0) return
        const response = await fetch('/api/admin/bulkpairaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: Array.from(selected), action }),
        })
        const res = await response.json()
        if (res.success) {
            NotificationManager.success("Done", `${action} applied to ${res.count} pair(s)`, 5000)
            router.reload()
        } else {
            NotificationManager.error("Error", `${res.err}`, 5000)
        }
    }


    const cols: Column<PairProps>[] = [
        {
            key: "pair", label: "Pair", sortable: true, render: (p) => (
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 600 }}>{p.pair}</span>
                    <span className="muted" style={{ fontSize: "var(--fs-xs)" }}><ChainName chain={p.chain} /> · <DexName dex={p.dex} /></span>
                </div>
            ),
        },
        { key: "driver", label: "Decision driver", render: (p) => <span className="muted" style={{ display: "inline-block", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--fs-xs)" }}>{p.verificationComment || "—"}</span> },
        {
            key: "reserveUsd", label: "Reserve", num: true, sortable: true, render: (p) => {
                const floor = props.floorMap[p.chain]?.[p.dex]
                const tone = floor == null ? undefined : p.reserveUsd < floor ? "var(--fail)" : "var(--pass)"
                return <span style={{ color: tone }}>{usd(p.reserveUsd)}</span>
            },
        },
        { key: "txCount", label: "Tx", num: true, sortable: true, render: (p) => num(p.txCount) },
        { key: "confidence", label: "Conf", sortable: true, sortVal: (p) => p.confidence ?? -1, render: (p) => <ConfidenceMeter value={p.confidence} compact /> },
        { key: "status", label: "Status", render: (p) => <StatusBadge status={p.status} size="sm" /> },
    ]
    if (props.status === TokenPairStatus.NeedsReview) {
        cols.push({ key: "reviewTier", label: "Triage", sortable: true, sortVal: (p) => p.reviewTier ?? "", render: (p) => <TriageBadge tier={p.reviewTier} /> })
    }

    const pageHref = (p: number) => hrefWith({ page: p })

    return (
        <Layout crumb="Review queue">
            <PageHeader
                title="Review queue"
                sub={`${props.totalCount} ${props.status === TokenPairStatus.NeedsReview ? "awaiting review" : "in this view"}${props.chain || props.dex ? " · filtered" : " · all sources"}`}
            />

            {/* Status tabs */}
            <div className="tabs">
                {PAIR_TABS.map((t) => (
                    <Link key={t.status} href={hrefWith({ status: t.status })}>
                        <a className={`tab${props.status === t.status ? " active" : ""}`}>
                            {t.label}<span className="tab-count">{props.statusCounts[t.status] ?? 0}</span>
                        </a>
                    </Link>
                ))}
            </div>

            {/* Filters */}
            <div className="filters card card-pad">
                <SearchBox value={props.q} placeholder="Search pairs by name…" onSearch={(q) => router.push(hrefWith({ q, page: 1 }))} />
                <select className="input" value={props.chain} onChange={(e) => router.push(hrefWith({ chain: e.target.value, dex: "", page: 1 }))}>
                    <option value="">All chains</option>
                    {props.chains.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="input" value={props.dex} onChange={(e) => router.push(hrefWith({ dex: e.target.value, page: 1 }))}>
                    <option value="">All DEXs</option>
                    {props.sources.filter((s) => !props.chain || s.chain === props.chain).map((s) => <option key={`${s.chain}_${s.dex}`} value={s.dex}>{s.dex}{props.chain ? "" : ` (${s.chain})`}</option>)}
                </select>
            </div>

            {/* Triage sub-filter (NeedsReview only) */}
            {props.status === TokenPairStatus.NeedsReview && (
                <div className="triage">
                    <span className="eyebrow">Triage</span>
                    <Link href={hrefWith({ tier: "" })}><a className={`chip${props.tier === "" ? " on" : ""}`}>All {(props.tierCounts.spam ?? 0) + (props.tierCounts.review ?? 0)}</a></Link>
                    <Link href={hrefWith({ tier: "spam" })}><a className={`chip chip-fail${props.tier === "spam" ? " on" : ""}`}>Likely spam {props.tierCounts.spam ?? 0}</a></Link>
                    <Link href={hrefWith({ tier: "review" })}><a className={`chip chip-warn${props.tier === "review" ? " on" : ""}`}>Worth a look {props.tierCounts.review ?? 0}</a></Link>
                    <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>— filter to spam, select all, Reject to clear junk in bulk.</span>
                </div>
            )}

            {/* Bulk action bar */}
            <div className={`bulkbar${selected.size > 0 ? " on" : ""}`}>
                <strong className="mono">{selected.size}</strong> selected
                <span className="grow" />
                <button type="button" className="btn btn-pass btn-sm" disabled={selected.size === 0} onClick={() => bulkAction("approve")}><Icon name="check" size={13} />Approve</button>
                <button type="button" className="btn btn-fail btn-sm" disabled={selected.size === 0} onClick={() => bulkAction("reject")}><Icon name="x" size={13} />Reject</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={selected.size === 0} onClick={() => bulkAction("rescan")}><Icon name="refresh" size={13} />Re-run</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={selected.size === 0} onClick={() => setSelected(new Set())}>Clear</button>
            </div>

            <DataTable
                columns={cols}
                data={props.pairs}
                rowKey={(p) => p.id}
                selectable
                selected={selected}
                onToggle={toggleSelected}
                onToggleAll={toggleAll}
                onRowClick={(p) => router.push(`/p/${p.id}?${detailQs}`)}
                serverSort={props.sort ? { key: props.sort, dir: props.dir === "asc" ? "asc" : "desc" } : null}
                onSortChange={(key, d) => router.push(hrefWith({ sort: key, dir: d, page: 1 }))}
                empty="Nothing in this queue 🎉"
            />

            <Pagination page={props.page} totalPages={props.totalPages} makeHref={pageHref} />

            <style jsx>{`
                .tabs { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-bottom: var(--sp-5); border-bottom: 1px solid var(--border); }
                .tab { display: inline-flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3) var(--sp-5); font-size: var(--fs-sm); color: var(--text-1); border-bottom: 2px solid transparent; margin-bottom: -1px; }
                .tab:hover { color: var(--text-0); }
                .tab.active { color: var(--accent-text); border-bottom-color: var(--accent); font-weight: 600; }
                .tab-count { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-2); background: var(--bg-3); padding: 0 6px; border-radius: var(--r-pill); }
                .tab.active .tab-count { color: var(--accent-text); background: var(--accent-dim); }
                .filters { display: flex; gap: var(--sp-4); align-items: center; margin-bottom: var(--sp-4); flex-wrap: wrap; }
                .ico-input { position: relative; display: inline-flex; align-items: center; flex: 1; min-width: 220px; }
                .ico-input :global(.ico) { position: absolute; left: 10px; color: var(--text-2); }
                .ico-input .input { width: 100%; padding-left: 30px; }
                .triage { display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-4); flex-wrap: wrap; }
                .chip { font-size: var(--fs-xs); padding: 3px 10px; border-radius: var(--r-pill); border: 1px solid var(--border-strong); color: var(--text-1); }
                .chip.on { border-color: var(--accent-line); background: var(--accent-dim); color: var(--accent-text); }
                .chip-fail.on { border-color: var(--fail-line, var(--fail)); background: var(--fail-dim, rgba(251,111,111,.13)); color: var(--fail); }
                .chip-warn.on { border-color: var(--warn-line, var(--warn)); background: var(--warn-dim, rgba(245,184,61,.13)); color: var(--warn); }
                .bulkbar { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); margin-bottom: var(--sp-4); border: 1px solid var(--border); border-radius: var(--r-md); font-size: var(--fs-sm); opacity: 0.6; transition: opacity .1s, border-color .1s; }
                .bulkbar.on { opacity: 1; border-color: var(--accent-line); background: var(--accent-dim); }
            `}</style>
        </Layout>
    )
}

function PairsPage(props: Props) {
    if (props.isOperator) {
        return <OperatorPairs {...(props as OperatorProps)} />
    }
    return <PublicPairs {...(props as PublicProps)} />
}

export default PairsPage
