import { GetServerSideProps } from "next"
import Link from "next/link";
import { useRouter } from "next/router";
import React from "react"

import ChainName from "../components/ChainName";
import Pagination from "../components/Pagination";
import Layout from "../components/shell/Layout"
import DataTable, { Column } from "../components/ui/DataTable";
import PageHeader from "../components/ui/PageHeader";
import SearchBox from "../components/ui/SearchBox";
import StatusBadge from "../components/ui/StatusBadge";
import { usd, num } from "../lib/format";
import { isOperatorCtx } from "../lib/operatorGate";
import prisma from '../lib/prisma';
import { VERIFIED_STATUSES } from "../lib/status";
import { TokenPairStatus } from "../types/types";

const PAGE_SIZE = 50

const TOKEN_TABS: { status: TokenPairStatus; label: string }[] = [
    { status: TokenPairStatus.Unverified, label: "Unverified" },
    { status: TokenPairStatus.AutoVerified, label: "Auto-Verified" },
    { status: TokenPairStatus.ManualVerified, label: "Verified" },
    { status: TokenPairStatus.Duplicate, label: "Duplicate" },
    { status: TokenPairStatus.NotCurrentlyUsable, label: "Not Usable" },
]

const cleanParam = (v: unknown): string | null =>
    typeof v === "string" && v !== "" && v !== "undefined" ? v : null;

// A token list row: identity fields + pool-derived aggregates. Token-level market
// data (volume / market cap / tx count) isn't captured by ingest — it only writes
// pair-level stats — so the only meaningful sortable numbers a token has come from
// summing its pools: total liquidity and pool count.
type ListToken = {
    id: string; symbol: string; name: string; chain: string;
    coingeckoCoinId: string | null; status: TokenPairStatus;
    isScamFlagged: boolean; scamReason: string | null;
    liquidityUsd: number; poolCount: number;
}
const tokenSelect = { id: true, symbol: true, name: true, chain: true, coingeckoCoinId: true, status: true, isScamFlagged: true, scamReason: true }

// Sortable columns + the normalised key/dir that drives the header indicator. The
// sort runs in-memory across the WHOLE filtered set (the aggregates are computed,
// not DB columns), then we paginate — so it spans the dataset, not just the page.
const TOKEN_SORT_KEYS = ["symbol", "liquidityUsd", "poolCount"]
function normalizeTokenSort(sort: string | null, dir: string | null): { sortKey: string; sortDir: "asc" | "desc" } {
    const sortKey = sort && TOKEN_SORT_KEYS.includes(sort) ? sort : "liquidityUsd"
    const sortDir: "asc" | "desc" = dir === "asc" ? "asc" : dir === "desc" ? "desc" : sortKey === "symbol" ? "asc" : "desc"
    return { sortKey, sortDir }
}
function compareTokens(a: ListToken, b: ListToken, key: string, dir: "asc" | "desc"): number {
    let r = 0
    if (key === "symbol") r = a.symbol.localeCompare(b.symbol)
    else if (key === "poolCount") r = a.poolCount - b.poolCount
    else r = a.liquidityUsd - b.liquidityUsd
    return dir === "asc" ? r : -r
}

// Sum pool liquidity + pool count per token across BOTH sides of every pair.
async function tokenAggregates(): Promise<{ liq: Map<string, number>; cnt: Map<string, number> }> {
    const [g0, g1] = await Promise.all([
        prisma.pair.groupBy({ by: ['token0Id'], _sum: { reserveUsd: true }, _count: { _all: true } }),
        prisma.pair.groupBy({ by: ['token1Id'], _sum: { reserveUsd: true }, _count: { _all: true } }),
    ])
    const liq = new Map<string, number>(); const cnt = new Map<string, number>()
    for (const g of g0) { liq.set(g.token0Id, (liq.get(g.token0Id) ?? 0) + (g._sum.reserveUsd ?? 0)); cnt.set(g.token0Id, (cnt.get(g.token0Id) ?? 0) + g._count._all) }
    for (const g of g1) { liq.set(g.token1Id, (liq.get(g.token1Id) ?? 0) + (g._sum.reserveUsd ?? 0)); cnt.set(g.token1Id, (cnt.get(g.token1Id) ?? 0) + g._count._all) }
    return { liq, cnt }
}

type RawToken = Omit<ListToken, "liquidityUsd" | "poolCount">
const enrich = (rows: RawToken[], liq: Map<string, number>, cnt: Map<string, number>): ListToken[] =>
    rows.map((t) => ({ ...t, liquidityUsd: liq.get(t.id) ?? 0, poolCount: cnt.get(t.id) ?? 0 }))

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const operator = await isOperatorCtx(ctx);
  const { query } = ctx;
  const chain = cleanParam(query?.chain)
  const q = cleanParam(query?.q)
  const page = Math.max(1, Number(query?.page || 1))
  const { sortKey, sortDir } = normalizeTokenSort(cleanParam(query?.sort), cleanParam(query?.dir))
  const paginate = (all: ListToken[]) => all.slice((page - 1) * PAGE_SIZE, (page - 1) * PAGE_SIZE + PAGE_SIZE)
  // Whole-dataset text search (server-side) on symbol / name / contract address.
  const search = q
    ? {
        OR: [
          { symbol: { contains: q, mode: "insensitive" as const } },
          { name: { contains: q, mode: "insensitive" as const } },
          { contractAddress: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {}

  // Public visitors get a read-only listing of VERIFIED tokens only.
  if (!operator) {
    const where = { status: { in: [...VERIFIED_STATUSES] }, ...(chain ? { chain } : {}), ...search }
    const [rows, agg, chainGroups] = await Promise.all([
      prisma.token.findMany({ where, select: tokenSelect }),
      tokenAggregates(),
      prisma.token.groupBy({ by: ['chain'], where: { status: { in: [...VERIFIED_STATUSES] } }, _count: { _all: true } }),
    ])
    const all = enrich(rows as RawToken[], agg.liq, agg.cnt).sort((a, b) => compareTokens(a, b, sortKey, sortDir))
    const chains = Array.from(new Set(chainGroups.map((g) => g.chain))).sort()
    return {
      props: {
        isOperator: false,
        tokens: paginate(all),
        chain: chain ?? "",
        q: q ?? "",
        page,
        totalPages: Math.max(1, Math.ceil(all.length / PAGE_SIZE)),
        totalCount: all.length,
        chains,
        sort: sortKey,
        dir: sortDir,
      },
    }
  }

    const qStatus = String(query?.status || TokenPairStatus.Unverified) as TokenPairStatus
    const scope: Record<string, string> = {}
    if (chain) scope.chain = chain
    const where = { ...scope, status: qStatus, ...search }

    const [rows, agg, statusGroups, chainGroups] = await Promise.all([
        prisma.token.findMany({ where, select: tokenSelect }),
        tokenAggregates(),
        prisma.token.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
        prisma.token.groupBy({ by: ['chain'], _count: { _all: true } }),
    ]);
    const all = enrich(rows as RawToken[], agg.liq, agg.cnt).sort((a, b) => compareTokens(a, b, sortKey, sortDir))

    const statusCounts: Record<string, number> = {}
    for (const g of statusGroups) statusCounts[g.status] = g._count._all
    const chains = Array.from(new Set(chainGroups.map((g) => g.chain))).sort()

    return {
        props: {
            isOperator: true,
            tokens: paginate(all),
            chain: chain ?? "",
            q: q ?? "",
            status: qStatus,
            page,
            totalPages: Math.max(1, Math.ceil(all.length / PAGE_SIZE)),
            totalCount: all.length,
            statusCounts,
            chains,
            sort: sortKey,
            dir: sortDir,
        },
    };
}

type OperatorProps = {
    isOperator: true,
    tokens: ListToken[],
    chain: string,
    q: string,
    status: TokenPairStatus,
    page: number,
    totalPages: number,
    totalCount: number,
    statusCounts: Record<string, number>,
    chains: string[],
    sort: string,
    dir: string,
}
type PublicProps = {
    isOperator: false,
    tokens: ListToken[],
    chain: string,
    q: string,
    page: number,
    totalPages: number,
    totalCount: number,
    chains: string[],
    sort: string,
    dir: string,
}
type Props = OperatorProps | PublicProps;

// Token columns shared by both views. Liquidity + Pools are summed from the
// token's pairs (token-level market data isn't ingested), so they're the only
// numbers that actually vary — and the only useful things to sort by.
const baseTokenCols = (): Column<ListToken>[] => [
    {
        key: "symbol", label: "Token", sortable: true, render: (t) => (
            <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontWeight: 600 }}>{t.symbol}</span>
                <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>{t.name}</span>
            </div>
        ),
    },
    { key: "chain", label: "Chain", render: (t) => <ChainName chain={t.chain} /> },
    {
        key: "identity", label: "Identity", render: (t) =>
            t.coingeckoCoinId ? <span className="badge badge-pass badge-sm">CoinGecko</span> : <span className="muted">—</span>,
    },
    { key: "liquidityUsd", label: "Liquidity", num: true, sortable: true, render: (t) => usd(t.liquidityUsd) },
    { key: "poolCount", label: "Pools", num: true, sortable: true, render: (t) => num(t.poolCount) },
    { key: "status", label: "Status", render: (t) => <StatusBadge status={t.status} size="sm" /> },
];

const PublicTokens: React.FC<PublicProps> = (props) => {
    const router = useRouter()

    const hrefWith = (over: Partial<{ chain: string; q: string; page: number; sort: string; dir: string }>): string => {
        const qs = new URLSearchParams()
        const chain = over.chain ?? props.chain
        const q = over.q ?? props.q
        const sort = over.sort ?? props.sort
        const dir = over.dir ?? props.dir
        if (chain) qs.set("chain", chain)
        if (q) qs.set("q", q)
        if (sort) { qs.set("sort", sort); if (dir) qs.set("dir", dir) }
        if (over.page && over.page > 1) qs.set("page", String(over.page))
        const s = qs.toString()
        return s ? `/tokens?${s}` : "/tokens"
    }

    return (
        <Layout crumb="Verified tokens">
            <PageHeader title="Verified tokens" sub={`${props.totalCount} verified ${props.chain ? `on ${props.chain}` : "across all chains"}`} />

            <div className="filters card card-pad">
                <SearchBox value={props.q} placeholder="Search symbol / name / address…" onSearch={(q) => router.push(hrefWith({ q, page: 1 }))} />
                <select className="input" value={props.chain} onChange={(e) => router.push(hrefWith({ chain: e.target.value, page: 1 }))}>
                    <option value="">All chains</option>
                    {props.chains.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>

            <DataTable
                columns={baseTokenCols()}
                data={props.tokens}
                rowKey={(t) => t.id}
                onRowClick={(t) => router.push(`/t/${t.id}`)}
                serverSort={props.sort ? { key: props.sort, dir: props.dir === "asc" ? "asc" : "desc" } : null}
                onSortChange={(key, d) => router.push(hrefWith({ sort: key, dir: d, page: 1 }))}
                empty="No verified tokens in this view."
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

const OperatorTokens: React.FC<OperatorProps> = (props) => {
    const router = useRouter()

    const hrefWith = (over: Partial<{ status: string; chain: string; q: string; page: number; sort: string; dir: string }>): string => {
        const qs = new URLSearchParams()
        qs.set("status", over.status ?? props.status)
        const chain = over.chain ?? props.chain
        const q = over.q ?? props.q
        const sort = over.sort ?? props.sort
        const dir = over.dir ?? props.dir
        if (chain) qs.set("chain", chain)
        if (q) qs.set("q", q)
        if (sort) { qs.set("sort", sort); if (dir) qs.set("dir", dir) }
        if (over.page && over.page > 1) qs.set("page", String(over.page))
        return `/tokens?${qs.toString()}`
    }

    // The operator view inserts a Scam column before the aggregate columns.
    const cols: Column<ListToken>[] = [...baseTokenCols()]
    cols.splice(3, 0, {
        key: "scam", label: "Scam", render: (t) =>
            t.isScamFlagged ? <span className="badge badge-fail badge-sm" title={t.scamReason ?? undefined}>flagged</span> : <span className="muted">clear</span>,
    })

    return (
        <Layout crumb="Tokens">
            <PageHeader title="Tokens" sub={`${props.totalCount} ${props.chain ? `on ${props.chain}` : "across all chains"}`} />

            <div className="tabs">
                {TOKEN_TABS.map((t) => (
                    <Link key={t.status} href={hrefWith({ status: t.status })}>
                        <a className={`tab${props.status === t.status ? " active" : ""}`}>
                            {t.label}<span className="tab-count">{props.statusCounts[t.status] ?? 0}</span>
                        </a>
                    </Link>
                ))}
            </div>

            <div className="filters card card-pad">
                <SearchBox value={props.q} placeholder="Search symbol / name / address…" onSearch={(q) => router.push(hrefWith({ q, page: 1 }))} />
                <select className="input" value={props.chain} onChange={(e) => router.push(hrefWith({ chain: e.target.value, page: 1 }))}>
                    <option value="">All chains</option>
                    {props.chains.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>

            <DataTable
                columns={cols}
                data={props.tokens}
                rowKey={(t) => t.id}
                onRowClick={(t) => router.push(`/t/${t.id}`)}
                serverSort={props.sort ? { key: props.sort, dir: props.dir === "asc" ? "asc" : "desc" } : null}
                onSortChange={(key, d) => router.push(hrefWith({ sort: key, dir: d, page: 1 }))}
                empty="No tokens in this view."
            />

            <Pagination page={props.page} totalPages={props.totalPages} makeHref={(p) => hrefWith({ page: p })} />

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
            `}</style>
        </Layout>
    )
}

function TokensPage(props: Props) {
    if (props.isOperator) {
        return <OperatorTokens {...(props as OperatorProps)} />
    }
    return <PublicTokens {...(props as PublicProps)} />
}

export default TokensPage
