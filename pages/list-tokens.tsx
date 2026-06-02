import { GetServerSideProps} from "next"
import Link from "next/link";
import React from "react"

import ChainName from "../components/ChainName";
import Layout from "../components/Layout"
import Pagination from "../components/Pagination";
import SortableTable from "../components/SortableTable/SortableTable";
import Status from "../components/Status";
import prisma from '../lib/prisma';
import {TokenProps} from "../types/props";
import {TokenPairStatus} from "../types/types";

const PAGE_SIZE = 50

export const getServerSideProps: GetServerSideProps = async ({ params: _params, query }) => {

    const chain = String(query?.chain)
    const qStatus = String(query?.status || TokenPairStatus.Unverified) as TokenPairStatus
    const page = Math.max(1, Number(query?.page || 1))

    const where = { chain, status: qStatus }

    const [tokens, totalCount, statusGroups, symbolGroups] = await Promise.all([
        prisma.token.findMany({
            where,
            include: {
                _count: {
                    select: { duplicateTokenSymbols: true },
                },
            },
            orderBy: [
                {
                    symbol: 'asc',
                },
            ],
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE,
        }),
        prisma.token.count({ where }),
        prisma.token.groupBy({ by: ['status'], where: { chain }, _count: { _all: true } }),
        // Count per symbol across the FULL status set so "Dupes" stays
        // accurate even though rows are paginated.
        prisma.token.groupBy({ by: ['symbol'], where, _count: { symbol: true } }),
    ]);

    const statusCounts: Record<string, number> = {}
    for (const g of statusGroups) {
        statusCounts[g.status] = g._count._all
    }

    const symbolCounts: Record<string, number> = {}
    for (const g of symbolGroups) {
        symbolCounts[g.symbol] = g._count.symbol
    }

    const tokensWithCount = (tokens as unknown as TokenProps[])
    for (const t of tokensWithCount) {
        t.duplicateCount = (symbolCounts[t.symbol] ?? 1) - 1
    }

    return {
        props: {
            tokens: tokensWithCount,
            chain,
            status: qStatus,
            page,
            totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
            statusCounts,
        },
    };
}

type Props = {
    tokens: TokenProps[],
    chain: string,
    status: TokenPairStatus,
    page: number,
    totalPages: number,
    statusCounts: Record<string, number>,
}

const ListTokens: React.FC<Props> = (props) => {

    let columns = [
        { label: "Symbol", accessor: "symbol", sortable: true, sortbyOrder: "asc", cellType: "display" },
        { label: "Name", accessor: "name", sortable: true, cellType: "display" },
        { label: "Market Cap", accessor: "marketCapUsd", sortable: true, cellType: "usd" },
        { label: "24h Volume", accessor: "volume24hUsd", sortable: true, cellType: "usd" },
        { label: "Tx Count", accessor: "txCount", sortable: true, cellType: "number" },
        { label: `Dupes (status ${props.status})`, accessor: "duplicateCount", sortable: true, cellType: "display" },
        { label: "Total Dupes", accessor: "_count.duplicateTokenSymbols", sortable: true, cellType: "display" },
        // { label: "Edit", accessor: "id", sortable: false, cellType: "edit_button", router: {url: "/t/[id]", as: "/t/__ID__"} },
    ];

    if(props.status === TokenPairStatus.Unverified) {
        columns = [
            ...columns,
            { label: "Imported", accessor: "createdAt", sortable: true, cellType: "datetime" },
        ]
    }

    columns = [
        ...columns,
        // @ts-ignore — column literals' `meta` widens the union; TS infers narrower
        { label: "", accessor: "id", sortable: false, cellType: "edit_link", meta: {url: "/t/__ID__", text: "View/Edit"} },
    ]

    return (
        <Layout>
            <div className="page" key={`token_list_${props.chain}_${props.status}`}>
                <h1><Status status={props.status} method={""} /> Tokens</h1>
                <h2>Chain: <ChainName chain={props.chain}/></h2>
                <h3>
                    <Link
                        href={`/list-tokens?chain=${encodeURIComponent(props.chain)}&status=${TokenPairStatus.Unverified}`}>
                        <a>Unverified ({props.statusCounts[TokenPairStatus.Unverified] ?? 0})</a>
                    </Link>
                    &nbsp;|&nbsp;
                    <Link
                        href={`/list-tokens?chain=${encodeURIComponent(props.chain)}&status=${TokenPairStatus.ManualVerified}`}>
                        <a>VERIFIED ({props.statusCounts[TokenPairStatus.ManualVerified] ?? 0})</a>
                    </Link>
                    &nbsp;|&nbsp;
                    <Link
                        href={`/list-tokens?chain=${encodeURIComponent(props.chain)}&status=${TokenPairStatus.Duplicate}`}>
                        <a>Duplicate ({props.statusCounts[TokenPairStatus.Duplicate] ?? 0})</a>
                    </Link>
                    &nbsp;|&nbsp;
                    <Link
                        href={`/list-tokens?chain=${encodeURIComponent(props.chain)}&status=${TokenPairStatus.NotCurrentlyUsable}`}>
                        <a>Fake/Bad/Not Usable ({props.statusCounts[TokenPairStatus.NotCurrentlyUsable] ?? 0})</a>
                    </Link>
                </h3>
                <main>
                    <Pagination
                        page={props.page}
                        totalPages={props.totalPages}
                        makeHref={(p) => `/list-tokens?chain=${encodeURIComponent(props.chain)}&status=${props.status}&page=${p}`}
                    />
                    <SortableTable
                        key={`token_list_${props.chain}_${props.status}_${props.page}`}
                        caption=""
                        data={props.tokens}
                        columns={columns}
                        useFilter={true}
                    />
                    <Pagination
                        page={props.page}
                        totalPages={props.totalPages}
                        makeHref={(p) => `/list-tokens?chain=${encodeURIComponent(props.chain)}&status=${props.status}&page=${p}`}
                    />
                </main>
            </div>
            <style jsx>{`
                .token {
                    background: white;
                    transition: box-shadow 0.1s ease-in;
                }

                .token:hover {
                    box-shadow: 1px 1px 3px #aaa;
                }

                .token + .token {
                    margin-top: 2rem;
                }


            `}</style>
        </Layout>
    )
}

export default ListTokens
