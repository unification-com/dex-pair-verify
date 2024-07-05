import React, {FormEvent, useEffect, useState} from "react"
import { GetServerSideProps} from "next"
import {NotificationManager} from 'react-notifications';
import Layout from "../components/Layout"
import prisma from '../lib/prisma';
import Status from "../components/Status";
import Link from "next/link";
import ChainName from "../components/ChainName";
import DexName from "../components/DexName";
import SortableTable from "../components/SortableTable/SortableTable";
import {PairProps, ThresholdProps} from "../types/props";
import {TokenPairStatus} from "../types/types";

export const getServerSideProps: GetServerSideProps = async ({ params, query }) => {

    const qStatus = Number(query?.status || 0)
    const chain = String(query?.chain)
    const dex = String(query?.dex)
    const pairs = await prisma.pair.findMany({
        where: {
            chain,
            dex,
            status: qStatus,
        },
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
    });

    const dupeCounter = {}
    const pairsWithDuplicates = (pairs as unknown as PairProps[])

    for(let i = 0; i < pairs.length; i += 1) {
        const p = pairs[i]
        const p1 = `${p.token0.symbol}-${p.token1.symbol}`
        const p2 = `${p.token1.symbol}-${p.token0.symbol}`
        if(dupeCounter[p1] === undefined) {
            dupeCounter[p1] = 0
        } else {
            dupeCounter[p1] += 1
        }
        if(dupeCounter[p2] === undefined) {
            dupeCounter[p2] = 0
        } else {
            dupeCounter[p2] += 1
        }
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

    for(let i = 0; i < pairsWithDuplicates.length; i += 1) {
        const p = pairsWithDuplicates[i]
        pairsWithDuplicates[i].duplicateCount = dupeCounter[p.pair]
    }

    return {
        props: {
            pairs: pairsWithDuplicates,
            chain: String(query?.chain),
            dex: String(query?.dex),
            status: Number(query?.status || 0),
            thresholds,
        },
    };
}

type Props = {
    pairs: PairProps[],
    chain: string,
    dex: string,
    status: number,
    thresholds: ThresholdProps;
}

const ListPairs: React.FC<Props> = (props) => {

    const [thresholdMinLiquidity, setThresholdMinLiquidity] = useState((props.thresholds.minLiquidityUsd === null) ? 0 : props.thresholds.minLiquidityUsd)
    const [thresholdMinTxCount, setThresholdMinTxCount] = useState((props.thresholds.minTxCount === null) ? 0 : props.thresholds.minTxCount)

    if(thresholdMinLiquidity !== props.thresholds.minLiquidityUsd) {
        setThresholdMinLiquidity(props.thresholds.minLiquidityUsd)
    }
    if(thresholdMinTxCount !== props.thresholds.minTxCount) {
        setThresholdMinTxCount(props.thresholds.minTxCount)
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

    if(props.status === TokenPairStatus.Unverified) {
        columns = [
            ...columns,
            { label: "Imported", accessor: "createdAt", sortable: true, cellType: "datetime" },
        ]
    }

    columns = [
        ...columns,
        // @ts-ignore
        { label: "", accessor: "id", sortable: false, cellType: "edit_link", meta: {url: "/p/__ID__", text: "View/Edit"} },
    ]

    if(props.status === TokenPairStatus.Verified) {
        columns = [
            ...columns,
            // @ts-ignore
            { label: "", accessor: "id", sortable: false, cellType: "edit_link", meta: {url: "/p/test/pair/__ID__", text: "Test Query"} },
            // @ts-ignore
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
                    These thresholds will determine which <Status status={TokenPairStatus.Verified}  method={""}/> pairs/tokens will be used in the OoO simulations
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
                        <a>Unverified</a>
                    </Link>
                    &nbsp;|&nbsp;
                    <Link
                        href={`/list-pairs?chain=${encodeURIComponent(props.chain)}&dex=${encodeURIComponent(props.dex)}&status=${TokenPairStatus.Verified}`}>
                        <a>VERIFIED</a>
                    </Link>
                    &nbsp;|&nbsp;
                    <Link
                        href={`/list-pairs?chain=${encodeURIComponent(props.chain)}&dex=${encodeURIComponent(props.dex)}&status=${TokenPairStatus.Duplicate}`}>
                        <a>Duplicate</a>
                    </Link>
                    &nbsp;|&nbsp;
                    <Link
                        href={`/list-pairs?chain=${encodeURIComponent(props.chain)}&dex=${encodeURIComponent(props.dex)}&status=${TokenPairStatus.NotCurrentlyUsable}`}>
                        <a>Fake/Bad/Not Usable</a>
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
                    <SortableTable
                        key={`pair_list_${props.chain}_${props.dex}_${props.status}`}
                        caption=""
                        data={props.pairs}
                        columns={columns}
                        useFilter={true}
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
