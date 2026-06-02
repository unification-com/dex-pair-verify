import { GetServerSideProps} from "next"
import Link from "next/link";
import React, {FormEvent, useEffect, useState} from "react"
import {NotificationManager} from 'react-notifications';

import ChainName from "../components/ChainName";
import DexName from "../components/DexName";
import Layout from "../components/Layout"
import Pagination from "../components/Pagination";
import SortableTable from "../components/SortableTable/SortableTable";
import Status from "../components/Status";
import prisma from '../lib/prisma';
import {PairProps, ThresholdProps} from "../types/props";
import {TokenPairStatus} from "../types/types";

const PAGE_SIZE = 50

export const getServerSideProps: GetServerSideProps = async ({ params: _params, query }) => {

    const qStatus = String(query?.status || TokenPairStatus.Unverified) as TokenPairStatus
    const chain = String(query?.chain)
    const dex = String(query?.dex)
    const page = Math.max(1, Number(query?.page || 1))

    const where = { chain, dex, status: qStatus }

    const [pairs, totalCount, statusGroups, pairGroups] = await Promise.all([
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
    ]);

    const statusCounts: Record<string, number> = {}
    for (const g of statusGroups) {
        statusCounts[g.status] = g._count._all
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
        thresholds = await prisma.threshold.create({
            data: {
                chain,
                dex,
                minLiquidityUsd: 0,
                minTxCount: 0,
            }
        })
    }

    const pairsWithDuplicates = (pairs as unknown as PairProps[])
    for (const p of pairsWithDuplicates) {
        p.duplicateCount = (pairCounts[p.pair] ?? 1) - 1
    }

    return {
        props: {
            pairs: pairsWithDuplicates,
            chain,
            dex,
            status: qStatus,
            thresholds,
            page,
            totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
            statusCounts,
        },
    };
}

type Props = {
    pairs: PairProps[],
    chain: string,
    dex: string,
    status: TokenPairStatus,
    thresholds: ThresholdProps;
    page: number,
    totalPages: number,
    statusCounts: Record<string, number>,
}

const ListPairs: React.FC<Props> = (props) => {

    const [thresholdMinLiquidity, setThresholdMinLiquidity] = useState((props.thresholds.minLiquidityUsd === null) ? 0 : props.thresholds.minLiquidityUsd)
    const [thresholdMinTxCount, setThresholdMinTxCount] = useState((props.thresholds.minTxCount === null) ? 0 : props.thresholds.minTxCount)

    // Re-sync the editable threshold state when the route's (chain, dex)
    // changes — the pages router re-renders this same component instance
    // with new props rather than remounting it.
    useEffect(() => {
        setThresholdMinLiquidity(props.thresholds.minLiquidityUsd ?? 0)
        setThresholdMinTxCount(props.thresholds.minTxCount ?? 0)
    }, [props.thresholds.minLiquidityUsd, props.thresholds.minTxCount])

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

    if(props.status === TokenPairStatus.ManualVerified) {
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
                    <Link
                        href={`/list-pairs?chain=${encodeURIComponent(props.chain)}&dex=${encodeURIComponent(props.dex)}&status=${TokenPairStatus.Unverified}`}>
                        <a>Unverified ({props.statusCounts[TokenPairStatus.Unverified] ?? 0})</a>
                    </Link>
                    &nbsp;|&nbsp;
                    <Link
                        href={`/list-pairs?chain=${encodeURIComponent(props.chain)}&dex=${encodeURIComponent(props.dex)}&status=${TokenPairStatus.ManualVerified}`}>
                        <a>VERIFIED ({props.statusCounts[TokenPairStatus.ManualVerified] ?? 0})</a>
                    </Link>
                    &nbsp;|&nbsp;
                    <Link
                        href={`/list-pairs?chain=${encodeURIComponent(props.chain)}&dex=${encodeURIComponent(props.dex)}&status=${TokenPairStatus.Duplicate}`}>
                        <a>Duplicate ({props.statusCounts[TokenPairStatus.Duplicate] ?? 0})</a>
                    </Link>
                    &nbsp;|&nbsp;
                    <Link
                        href={`/list-pairs?chain=${encodeURIComponent(props.chain)}&dex=${encodeURIComponent(props.dex)}&status=${TokenPairStatus.NotCurrentlyUsable}`}>
                        <a>Fake/Bad/Not Usable ({props.statusCounts[TokenPairStatus.NotCurrentlyUsable] ?? 0})</a>
                    </Link>
                </h3>
                <main>
                    {
                        (props.status === TokenPairStatus.Duplicate) && <>
                            <p>
                                <strong>Note:</strong> Duplicate includes both duplicate pairs and pairs that may contain
                                duplicate token symbols
                            </p>
                        </>
                    }
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
