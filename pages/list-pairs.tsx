import { GetServerSideProps} from "next"
import Link from "next/link";
import {useRouter} from "next/router";
import React, {FormEvent, useEffect, useState} from "react"
import {NotificationManager} from 'react-notifications';

import ChainName from "../components/ChainName";
import DexName from "../components/DexName";
import Layout from "../components/Layout"
import Pagination from "../components/Pagination";
import SortableTable from "../components/SortableTable/SortableTable";
import Status from "../components/Status";
import prisma from '../lib/prisma';
import {thresholdSeedData} from "../lib/sourceConfig";
import {isVerifiedStatus} from "../lib/status";
import {PairProps, ThresholdProps} from "../types/props";
import {TokenPairStatus} from "../types/types";

const PAGE_SIZE = 50

// Tab order for the pair queue. Needs Review is the operator's working queue
// (the shrunken manual bucket), so it leads and is the default landing tab.
const PAIR_TABS: { status: TokenPairStatus; label: string }[] = [
    { status: TokenPairStatus.NeedsReview, label: "Needs Review" },
    { status: TokenPairStatus.AutoVerified, label: "Auto-Verified" },
    { status: TokenPairStatus.ManualVerified, label: "VERIFIED" },
    { status: TokenPairStatus.AutoRejected, label: "Auto-Rejected" },
    { status: TokenPairStatus.Unverified, label: "Unverified" },
    { status: TokenPairStatus.Duplicate, label: "Duplicate" },
    { status: TokenPairStatus.NotCurrentlyUsable, label: "Fake/Bad/Not Usable" },
]

export const getServerSideProps: GetServerSideProps = async ({ params: _params, query }) => {

    const qStatus = String(query?.status || TokenPairStatus.NeedsReview) as TokenPairStatus
    const chain = String(query?.chain)
    const dex = String(query?.dex)
    const page = Math.max(1, Number(query?.page || 1))

    // Review-queue triage sub-filter (T9) — only meaningful on the NeedsReview tab.
    const tier = qStatus === TokenPairStatus.NeedsReview && query?.tier ? String(query.tier) : undefined
    const where = { chain, dex, status: qStatus, ...(tier ? { reviewTier: tier } : {}) }

    const [pairs, totalCount, statusGroups, pairGroups, tierGroups] = await Promise.all([
        prisma.pair.findMany({
            where,
            include: {
                token0: {
                    select: { symbol: true, id: true, contractAddress: true, status: true, txCount: true },
                },
                token1: {
                    select: { symbol: true, id: true, contractAddress: true, status: true, txCount: true },
                },
                _count: {
                    select: { duplicatePairs: true },
                },
            },
            orderBy: [
                {
                    reserveNativeCurrency: 'desc',
                },
            ],
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE,
        }),
        prisma.pair.count({ where }),
        // Per-status counts for the tab labels (across this chain/dex).
        prisma.pair.groupBy({ by: ['status'], where: { chain, dex }, _count: { _all: true } }),
        // Count per pair-symbol across the FULL status set so the "Dupes"
        // column stays accurate even though rows are paginated.
        prisma.pair.groupBy({ by: ['pair'], where, _count: { pair: true } }),
        // Per-tier counts for the NeedsReview triage sub-filter (across all tiers).
        prisma.pair.groupBy({ by: ['reviewTier'], where: { chain, dex, status: TokenPairStatus.NeedsReview }, _count: { _all: true } }),
    ]);

    const statusCounts: Record<string, number> = {}
    for (const g of statusGroups) {
        statusCounts[g.status] = g._count._all
    }

    const tierCounts: Record<string, number> = {}
    for (const g of tierGroups) {
        if (g.reviewTier) {
            tierCounts[g.reviewTier] = g._count._all
        }
    }

    const pairCounts: Record<string, number> = {}
    for (const g of pairGroups) {
        pairCounts[g.pair] = g._count.pair
    }

    let thresholds = await prisma.threshold.findFirst({
        where: {
            chain,
            dex,
        }
    })

    if(thresholds === null) {
        thresholds = await prisma.threshold.create({ data: thresholdSeedData(chain, dex) })
    }

    const pairsWithDuplicates = (pairs as unknown as PairProps[])
    for (const p of pairsWithDuplicates) {
        p.duplicateCount = (pairCounts[p.pair] ?? 1) - 1
        p.reviewTierLabel = p.reviewTier === "spam" ? "🚩 Likely spam" : p.reviewTier === "review" ? "👀 Worth a look" : ""
    }

    return {
        props: {
            pairs: pairsWithDuplicates,
            chain,
            dex,
            status: qStatus,
            tier: tier ?? "",
            thresholds,
            page,
            totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
            statusCounts,
            tierCounts,
        },
    };
}

type Props = {
    pairs: PairProps[],
    chain: string,
    dex: string,
    status: TokenPairStatus,
    tier: string,
    thresholds: ThresholdProps;
    page: number,
    totalPages: number,
    statusCounts: Record<string, number>,
    tierCounts: Record<string, number>,
}

const ListPairs: React.FC<Props> = (props) => {

    const [thresholdMinLiquidity, setThresholdMinLiquidity] = useState((props.thresholds.minLiquidityUsd === null) ? 0 : props.thresholds.minLiquidityUsd)
    const [thresholdMinTxCount, setThresholdMinTxCount] = useState((props.thresholds.minTxCount === null) ? 0 : props.thresholds.minTxCount)

    const router = useRouter()

    // Re-sync the editable threshold state when the route's (chain, dex)
    // changes — the pages router re-renders this same component instance
    // with new props rather than remounting it.
    useEffect(() => {
        setThresholdMinLiquidity(props.thresholds.minLiquidityUsd ?? 0)
        setThresholdMinTxCount(props.thresholds.minTxCount ?? 0)
    }, [props.thresholds.minLiquidityUsd, props.thresholds.minTxCount])

    // Bulk-selection state for the review queue. Cleared whenever the route
    // (chain / dex / status / page) changes so a stale selection can't carry
    // across views.
    const [selected, setSelected] = useState<Set<string>>(new Set())
    useEffect(() => {
        setSelected(new Set())
    }, [props.chain, props.dex, props.status, props.page])

    const toggleSelected = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }

    async function bulkAction(action: "approve" | "reject" | "rescan") {
        if (selected.size === 0) {
            return
        }
        const response = await fetch('/api/bulkpairaction', {
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

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()

        const formData = new FormData(event.currentTarget)
        const response = await fetch('/api/setthresholds', {
            method: 'POST',
            body: formData,
        })

        // Handle response if necessary
        const res = await response.json()

        if(res.success) {
            NotificationManager.success("Success!", `Min Liquidity changed to $${res.data.new_min_liquidity}, Min Tx count set to ${res.data.new_min_tx_count}`, 5000);
            setThresholdMinLiquidity(res.data.new_min_liquidity)
            setThresholdMinTxCount(res.data.new_min_tx_count)
        } else {
            NotificationManager.error("Error", `${res.err}`, 5000)
        }
    }

    let columns = [
        {label: "Pair", accessor: "pair", sortable: true, sortbyOrder: "asc", cellType: "display"},
        {label: "(Token 0 Status)", accessor: "token0.status", sortable: true, cellType: "status"},
        {label: "(Token 1 Status)", accessor: "token1.status", sortable: true, cellType: "status"},
        { label: "Market Cap USD", accessor: "marketCapUsd", sortable: true, cellType: "usd" },
        { label: "24h Volume", accessor: "volumeUsd24h", sortable: true, cellType: "usd" },
        { label: "Reserve USD", accessor: "reserveUsd", sortable: true, cellType: "usd" },
        { label: "Tx Count", accessor: "txCount", sortable: true, cellType: "number" },
        {label: `Dupes (status ${props.status})`, accessor: "duplicateCount", sortable: true, cellType: "number"},
        {label: "Total Dupes", accessor: "_count.duplicatePairs", sortable: true, cellType: "number"},
    ];

    // Triage tier column on the Needs Review queue (T9).
    if (props.status === TokenPairStatus.NeedsReview) {
        columns = [
            ...columns,
            { label: "Triage", accessor: "reviewTierLabel", sortable: true, cellType: "display" },
        ]
    }

    columns = [
        // @ts-ignore — column literals' `selected`/`onToggle` widen the union; TS infers narrower
        { label: "", accessor: "id", sortable: false, cellType: "checkbox", selected, onToggle: toggleSelected },
        ...columns,
    ]

    if(props.status === TokenPairStatus.Unverified) {
        columns = [
            ...columns,
            { label: "Imported", accessor: "createdAt", sortable: true, cellType: "datetime" },
        ]
    }

    columns = [
        ...columns,
        // @ts-ignore — column literals' `meta`/`threshold` widen the union; TS infers narrower
        { label: "", accessor: "id", sortable: false, cellType: "edit_link", meta: {url: "/p/__ID__", text: "View/Edit"} },
    ]

    if(isVerifiedStatus(props.status)) {
        columns = [
            ...columns,
            // @ts-ignore — column literals' `meta`/`threshold` widen the union; TS infers narrower
            { label: "", accessor: "id", sortable: false, cellType: "edit_link", meta: {url: "/p/test/pair/__ID__", text: "Test Query"} },
            // @ts-ignore — column literals' `meta`/`threshold` widen the union; TS infers narrower
            { label: "OoO Sim Use?", accessor: "", sortable: false, cellType: "threshold_check", threshold: {minLiquidity: thresholdMinLiquidity, minTxCount: thresholdMinTxCount} },
        ]
    }

    return (
        <Layout>
            <div className="page" key={`pair_list_${props.chain}_${props.dex}_${props.status}`}>
                <h1><Status status={props.status} method={""}/> Pairs</h1>
                <h2>
                    Chain: <ChainName chain={props.chain}/><br/>
                    DEX: <DexName dex={props.dex}/>
                </h2>

                <h3>
                    Set OoO Simulation Thresholds
                </h3>
                <p>
                    These thresholds will determine which <Status status={TokenPairStatus.ManualVerified}  method={""}/> pairs/tokens will be used in the OoO simulations
                </p>
                <form onSubmit={onSubmit}>
                    Min Liquidity: $<input type={"text"} defaultValue={thresholdMinLiquidity} name={"min_liquidity"}
                           placeholder={"Minimum Liquidity"}/><br />
                    Min Tx Count: <input type={"text"} defaultValue={thresholdMinTxCount} name={"min_tx_count"}
                                           placeholder={"Minimum Tx Count"}/><br />
                    <input type={"hidden"} value={props.thresholds.id} name={"thresholdid"}/>
                    <button type="submit">Submit</button>
                </form>

                <h3>
                    {PAIR_TABS.map((t, i) => (
                        <span key={`pairtab_${t.status}`}>
                            {i > 0 && <>&nbsp;|&nbsp;</>}
                            <Link
                                href={`/list-pairs?chain=${encodeURIComponent(props.chain)}&dex=${encodeURIComponent(props.dex)}&status=${t.status}`}>
                                <a>{t.label} ({props.statusCounts[t.status] ?? 0})</a>
                            </Link>
                        </span>
                    ))}
                </h3>
                {props.status === TokenPairStatus.NeedsReview && (() => {
                    const base = `/list-pairs?chain=${encodeURIComponent(props.chain)}&dex=${encodeURIComponent(props.dex)}&status=${TokenPairStatus.NeedsReview}`
                    const spam = props.tierCounts.spam ?? 0
                    const review = props.tierCounts.review ?? 0
                    const link = (href: string, label: string, active: boolean) => (
                        <Link href={href}><a style={{ fontWeight: active ? 700 : 400 }}>{label}</a></Link>
                    )
                    return (
                        <h4>
                            Triage:&nbsp;
                            {link(base, `All (${spam + review})`, props.tier === "")}
                            &nbsp;|&nbsp;
                            {link(`${base}&tier=spam`, `🚩 Likely spam (${spam})`, props.tier === "spam")}
                            &nbsp;|&nbsp;
                            {link(`${base}&tier=review`, `👀 Worth a look (${review})`, props.tier === "review")}
                            &nbsp;&nbsp;<small style={{ opacity: 0.7 }}>— filter to &quot;Likely spam&quot; then select-all + Reject to clear junk in bulk.</small>
                        </h4>
                    )
                })()}
                <main>
                    {
                        (props.status === TokenPairStatus.Duplicate) && <>
                            <p>
                                <strong>Note:</strong> Duplicate includes both duplicate pairs and pairs that may contain
                                duplicate token symbols
                            </p>
                        </>
                    }
                    <div style={{ margin: "0.5rem 0", padding: "0.5rem", background: "#f4f4f4", border: "1px solid #ddd" }}>
                        <strong>{selected.size}</strong> selected&nbsp;&nbsp;
                        <button type="button" disabled={selected.size === 0} onClick={() => bulkAction("approve")}>Approve</button>
                        &nbsp;
                        <button type="button" disabled={selected.size === 0} onClick={() => bulkAction("reject")}>Reject</button>
                        &nbsp;
                        <button type="button" disabled={selected.size === 0} onClick={() => bulkAction("rescan")}>Re-run verdict</button>
                        &nbsp;
                        <button type="button" disabled={selected.size === 0} onClick={() => setSelected(new Set())}>Clear</button>
                    </div>
                    <Pagination
                        page={props.page}
                        totalPages={props.totalPages}
                        makeHref={(p) => `/list-pairs?chain=${encodeURIComponent(props.chain)}&dex=${encodeURIComponent(props.dex)}&status=${props.status}&page=${p}`}
                    />
                    <SortableTable
                        key={`pair_list_${props.chain}_${props.dex}_${props.status}_${props.page}`}
                        caption=""
                        data={props.pairs}
                        columns={columns}
                        useFilter={true}
                    />
                    <Pagination
                        page={props.page}
                        totalPages={props.totalPages}
                        makeHref={(p) => `/list-pairs?chain=${encodeURIComponent(props.chain)}&dex=${encodeURIComponent(props.dex)}&status=${props.status}&page=${p}`}
                    />
                </main>
            </div>
            <style jsx>{`
                .pair {
                    background: white;
                    transition: box-shadow 0.1s ease-in;
                }

                .pair:hover {
                    box-shadow: 1px 1px 3px #aaa;
                }

                .pair + .pair {
                    margin-top: 2rem;
                }


            `}</style>
        </Layout>
    )
}

export default ListPairs
