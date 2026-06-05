import { GetServerSideProps } from "next"
import Link from "next/link";
import { useRouter } from "next/router";
import React, { useState } from "react"

import ChainName from "../components/ChainName";
import Pagination from "../components/Pagination";
import Layout from "../components/shell/Layout"
import DataTable, { Column } from "../components/ui/DataTable";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import StatusBadge from "../components/ui/StatusBadge";
import { operatorGate } from "../lib/operatorGate";
import prisma from '../lib/prisma';
import { TokenProps } from "../types/props";
import { TokenPairStatus } from "../types/types";

const PAGE_SIZE = 50

const TOKEN_TABS: { status: TokenPairStatus; label: string }[] = [
    { status: TokenPairStatus.Unverified, label: "Unverified" },
    { status: TokenPairStatus.ManualVerified, label: "Verified" },
    { status: TokenPairStatus.Duplicate, label: "Duplicate" },
    { status: TokenPairStatus.NotCurrentlyUsable, label: "Not Usable" },
]

const cleanParam = (v: unknown): string | null =>
    typeof v === "string" && v !== "" && v !== "undefined" ? v : null;

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const gate = await operatorGate(ctx);
  if (gate) return gate;
  const { query } = ctx;
    const chain = cleanParam(query?.chain)
    const qStatus = String(query?.status || TokenPairStatus.Unverified) as TokenPairStatus
    const page = Math.max(1, Number(query?.page || 1))

    const scope: Record<string, string> = {}
    if (chain) scope.chain = chain
    const where = { ...scope, status: qStatus }

    const [tokens, totalCount, statusGroups, chainGroups] = await Promise.all([
        prisma.token.findMany({
            where,
            orderBy: [{ symbol: 'asc' }],
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE,
        }),
        prisma.token.count({ where }),
        prisma.token.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
        prisma.token.groupBy({ by: ['chain'], _count: { _all: true } }),
    ]);

    const statusCounts: Record<string, number> = {}
    for (const g of statusGroups) statusCounts[g.status] = g._count._all
    const chains = Array.from(new Set(chainGroups.map((g) => g.chain))).sort()

    return {
        props: {
            tokens,
            chain: chain ?? "",
            status: qStatus,
            page,
            totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
            totalCount,
            statusCounts,
            chains,
        },
    };
}

type Props = {
    tokens: TokenProps[],
    chain: string,
    status: TokenPairStatus,
    page: number,
    totalPages: number,
    totalCount: number,
    statusCounts: Record<string, number>,
    chains: string[],
}

const usd = (n: number | null | undefined) => {
    if (n == null) return "—";
    const a = Math.abs(n);
    if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return "$" + (n / 1e3).toFixed(1) + "k";
    return "$" + n.toFixed(2);
};
const num = (n: number | null | undefined) =>
    n == null ? "—" : new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(n);

const ListTokens: React.FC<Props> = (props) => {
    const router = useRouter()
    const [filter, setFilter] = useState("")

    const hrefWith = (over: Partial<{ status: string; chain: string; page: number }>): string => {
        const qs = new URLSearchParams()
        qs.set("status", over.status ?? props.status)
        const chain = over.chain ?? props.chain
        if (chain) qs.set("chain", chain)
        if (over.page && over.page > 1) qs.set("page", String(over.page))
        return `/tokens?${qs.toString()}`
    }

    const f = filter.trim().toLowerCase()
    const visible = f
        ? props.tokens.filter((t) => `${t.symbol} ${t.name}`.toLowerCase().includes(f))
        : props.tokens

    const cols: Column<TokenProps>[] = [
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
        {
            key: "scam", label: "Scam", render: (t) =>
                t.isScamFlagged ? <span className="badge badge-fail badge-sm" title={t.scamReason}>flagged</span> : <span className="muted">clear</span>,
        },
        { key: "volume24hUsd", label: "24h Vol", num: true, sortable: true, render: (t) => usd(t.volume24hUsd) },
        { key: "txCount", label: "Tx", num: true, sortable: true, render: (t) => num(t.txCount) },
        { key: "status", label: "Status", render: (t) => <StatusBadge status={t.status} size="sm" /> },
    ]

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
                <span className="ico-input">
                    <Icon name="search" size={14} />
                    <input className="input" placeholder="Filter symbol / name (this page)" value={filter} onChange={(e) => setFilter(e.target.value)} />
                </span>
                <select className="input" value={props.chain} onChange={(e) => router.push(hrefWith({ chain: e.target.value, page: 1 }))}>
                    <option value="">All chains</option>
                    {props.chains.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>

            <DataTable
                columns={cols}
                data={visible}
                rowKey={(t) => t.id}
                onRowClick={(t) => router.push(`/t/${t.id}`)}
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

export default ListTokens
