import React from "react"
import { GetServerSideProps} from "next"
import Layout from "../components/Layout"
import prisma from '../lib/prisma';
import Status from "../components/Status";
import Link from "next/link";
import Router from "next/router";
import ChainName from "../components/ChainName";
import DexName from "../components/DexName";
import SortableTable from "../components/SortableTable/SortableTable";
import {PairProps} from "../types/props";

export const getServerSideProps: GetServerSideProps = async ({ params, query }) => {

    const qStatus = Number(query?.status || 0)
    const pairs = await prisma.pair.findMany({
        where: {
            chain: String(query?.chain),
            dex: String(query?.dex),
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

    for(let i = 0; i < pairsWithDuplicates.length; i += 1) {
        const p = pairsWithDuplicates[i]
        pairsWithDuplicates[i].duplicateCount = dupeCounter[p.pair]
    }


    return {
        props: {
            pairs: pairsWithDuplicates,
            chain: String(query?.chain),
            dex: String(query?.dex),
            status: Number(query?.status || 0)
        },
    };
}

type Props = {
    pairs: PairProps[],
    chain: string,
    dex: string,
    status: number,
}

const ListPairs: React.FC<Props> = (props) => {
    const columns = [
        {label: "Pair", accessor: "pair", sortable: true, sortbyOrder: "asc", cellType: "display"},
        // {label: "Token 0", accessor: "token0.symbol", sortable: true, cellType: "display"},
        {label: "(Token 0 Status)", accessor: "token0.status", sortable: true, cellType: "status"},
        // {label: "Token 1", accessor: "token1.symbol", sortable: true, cellType: "display"},
        {label: "(Token 1 Status)", accessor: "token1.status", sortable: true, cellType: "status"},
        { label: "Tx Count", accessor: "txCount", sortable: true, cellType: "number" },
        { label: "Market Cap USD", accessor: "marketCapUsd", sortable: true, cellType: "usd" },
        { label: "24h Volume", accessor: "volumeUsd24h", sortable: true, cellType: "usd" },
        {label: `Dupes (status ${props.status})`, accessor: "duplicateCount", sortable: true, cellType: "number"},
        {label: "Total Dupes", accessor: "_count.duplicatePairs", sortable: true, cellType: "number"},
        // {
        //     label: "Edit",
        //     accessor: "id",
        //     sortable: false,
        //     cellType: "edit_button",
        //     router: {url: "/p/[id]", as: "/p/__ID__"}
        // },
        { label: "", accessor: "id", sortable: false, cellType: "edit_link", meta: {url: "/p/__ID__", text: "View/Edit"} },
    ];

    return (
        <Layout>
            <div className="page" key={`pair_list_${props.chain}_${props.dex}_${props.status}`}>
                <h1><Status status={props.status} method={""} /> Pairs</h1>
                <h2>
                    Chain: <ChainName chain={props.chain}/><br/>
                    DEX: <DexName dex={props.dex}/>
                </h2>
                <h3>
                    <Link
                        href={`/list-pairs?chain=${encodeURIComponent(props.chain)}&dex=${encodeURIComponent(props.dex)}&status=0`}>
                        <a>Unverified</a>
                    </Link>
                    &nbsp;|&nbsp;
                    <Link
                        href={`/list-pairs?chain=${encodeURIComponent(props.chain)}&dex=${encodeURIComponent(props.dex)}&status=1`}>
                        <a>VERIFIED</a>
                    </Link>
                    &nbsp;|&nbsp;
                    <Link
                        href={`/list-pairs?chain=${encodeURIComponent(props.chain)}&dex=${encodeURIComponent(props.dex)}&status=2`}>
                        <a>Duplicate</a>
                    </Link>
                    &nbsp;|&nbsp;
                    <Link
                        href={`/list-pairs?chain=${encodeURIComponent(props.chain)}&dex=${encodeURIComponent(props.dex)}&status=3`}>
                        <a>Fake/Bad/Not Usable</a>
                    </Link>
                </h3>
                <main>
                    {
                        (props.status === 2) && <>
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
