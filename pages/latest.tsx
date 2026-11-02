import { GetServerSideProps } from "next"
import { useRouter } from "next/router";
import React from "react"

import ChainName from "../components/ChainName";
import DexName from "../components/DexName";
import Layout from "../components/shell/Layout"
import SourceFilter from "../components/SourceFilter";
import Ago from "../components/ui/Ago";
import DataTable, { Column } from "../components/ui/DataTable";
import PageHeader from "../components/ui/PageHeader";
import StatusBadge from "../components/ui/StatusBadge";
import TokenStatusBadge from "../components/ui/TokenStatusBadge";
import { usd } from "../lib/format";
import { latestEntities } from "../lib/latest";
import { DEFAULT_LATEST_LIMIT, LATEST_LIMITS, LatestFilters, LatestRow, parseLatestFilters } from "../lib/latestFilters";
import { isOperatorCtx } from "../lib/operatorGate";
import { listHref } from "../lib/queryParams";
import { sourceOptions, SourceOption } from "../lib/sourceOptions";
import { VERIFIED_STATUSES } from "../lib/status";

// The newest pairs and tokens in one list, by date added or by latest status
// change. Operators see every status; public visitors the verified set only.
export const getServerSideProps: GetServerSideProps = async (ctx) => {
    const operator = await isOperatorCtx(ctx);
    const filters = parseLatestFilters(ctx.query)
    const [rows, options] = await Promise.all([
        latestEntities(filters, operator),
        sourceOptions(operator ? {} : { status: { in: [...VERIFIED_STATUSES] } }),
    ])
    return { props: { isOperator: operator, rows, filters, ...options } }
}

type Props = {
    isOperator: boolean,
    rows: LatestRow[],
    filters: LatestFilters,
    chains: string[],
    sources: SourceOption[],
}

const LatestPage: React.FC<Props> = ({ isOperator, rows, filters, chains, sources }) => {
    const router = useRouter()
    const changed = filters.order === "changed"

    // Defaults are left out of the URL.
    const go = (over: Partial<LatestFilters>) => {
        const f = { ...filters, ...over }
        router.push(listHref("/latest", {
            type: f.kind,
            chain: f.chain,
            dex: f.dex,
            order: f.order === "added" ? null : f.order,
            limit: f.limit === DEFAULT_LATEST_LIMIT ? null : String(f.limit),
        }))
    }

    const cols: Column<LatestRow>[] = [
        { key: "kind", label: "Type", render: (r) => <span className="badge badge-neutral badge-sm">{r.kind === "pair" ? "Pair" : "Token"}</span> },
        {
            key: "label", label: "Name", render: (r) => (
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 600 }}>{r.label}</span>
                    <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                        <ChainName chain={r.chain} /> · {r.dex ? <DexName dex={r.dex} /> : r.detail}
                    </span>
                </div>
            ),
        },
        { key: "reserveUsd", label: "Liquidity", num: true, render: (r) => usd(r.reserveUsd) },
        {
            key: "status", label: "Status", render: (r) => r.kind === "pair"
                ? <StatusBadge status={r.status} size="sm" />
                : <TokenStatusBadge status={r.status} scamFlagged={r.scamFlagged} scamReason={r.scamReason} size="sm" />,
        },
        { key: "at", label: changed ? "Status changed" : "Added", render: (r) => <Ago ts={r.at} /> },
    ]

    const what = filters.kind === "pair" ? "pairs" : filters.kind === "token" ? "tokens" : "pairs and tokens"
    const sub = `The last ${filters.limit} ${isOperator ? "" : "verified "}${what} ${changed ? "to change status" : "added"}`

    return (
        <Layout crumb="Latest">
            <PageHeader title="Latest" sub={sub} />

            <div className="filters card card-pad">
                <select className="input" value={filters.kind ?? ""} onChange={(e) => go({ kind: (e.target.value || null) as LatestFilters["kind"] })}>
                    <option value="">Pairs and tokens</option>
                    <option value="pair">Pairs</option>
                    <option value="token">Tokens</option>
                </select>
                <SourceFilter
                    chains={chains}
                    chain={filters.chain ?? ""}
                    sources={sources}
                    dex={filters.dex ?? ""}
                    onChange={(over) => go({ chain: over.chain ?? filters.chain, dex: over.dex || null })}
                />
                <select className="input" value={filters.order} onChange={(e) => go({ order: e.target.value as LatestFilters["order"] })}>
                    <option value="added">Newest added</option>
                    <option value="changed">Latest status change</option>
                </select>
                <select className="input" value={filters.limit} onChange={(e) => go({ limit: Number(e.target.value) })}>
                    {LATEST_LIMITS.map((n) => <option key={n} value={n}>Last {n}</option>)}
                </select>
            </div>

            <DataTable
                columns={cols}
                data={rows}
                rowKey={(r) => `${r.kind}_${r.id}`}
                onRowClick={(r) => router.push(r.kind === "pair" ? `/p/${r.id}` : `/t/${r.id}`)}
                empty="Nothing in this view."
            />

            {/* No search box here, so the selects sit side by side rather than one per line. */}
            <style jsx>{`
                .filters :global(select.input) { width: auto; min-width: 170px; }
            `}</style>
        </Layout>
    )
}

export default LatestPage
