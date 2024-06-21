import React from "react"
import { GetServerSideProps} from "next"
import Layout from "../components/Layout"
import prisma from '../lib/prisma';
import Status from "../components/Status";
import Link from "next/link";
import Router from "next/router";
import ChainName from "../components/ChainName";
import {TokenProps} from "../types/props";
import SortableTable from "../components/SortableTable/SortableTable";

export const getServerSideProps: GetServerSideProps = async ({ params, query }) => {

    const tokens = await prisma.token.findMany({
        where: {
            chain: String(query?.chain),
            status: Number(query?.status || 0),
        },
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
    });

    return {
        props: {
            tokens,
            chain: String(query?.chain),
            dex: String(query?.dex),
            status: Number(query?.status || 0),
        },
    };
}

type Props = {
    tokens: TokenProps[],
    chain: string,
    status: number,
}

const ListTokens: React.FC<Props> = (props) => {

    const columns = [
        { label: "Symbol", accessor: "symbol", sortable: true, sortbyOrder: "asc", cellType: "display" },
        { label: "Name", accessor: "name", sortable: true, cellType: "display" },
        { label: "Market Cap", accessor: "marketCapUsd", sortable: true, cellType: "usd" },
        { label: "24h Volume", accessor: "volume24hUsd", sortable: true, cellType: "usd" },
        { label: "Tx Count", accessor: "txCount", sortable: true, cellType: "number" },
        { label: "Possible Duplicates", accessor: "_count.duplicateTokenSymbols", sortable: true, cellType: "display" },
        { label: "Edit", accessor: "id", sortable: false, cellType: "edit_button", router: {url: "/t/[id]", as: "/t/__ID__"} },
    ];

    return (
        <Layout>
            <div className="page">
                <h1><Status status={props.status} method={""} /> Tokens</h1>
                <h2>Chain: <ChainName chain={props.chain}/></h2>
                <h3>
                    <Link
                        href={`/list-tokens?chain=${encodeURIComponent(props.chain)}&status=0`}>
                        <a>Unverified</a>
                    </Link>
                    &nbsp;|&nbsp;
                    <Link
                        href={`/list-tokens?chain=${encodeURIComponent(props.chain)}&status=1`}>
                        <a>VERIFIED</a>
                    </Link>
                    &nbsp;|&nbsp;
                    <Link
                        href={`/list-tokens?chain=${encodeURIComponent(props.chain)}&status=2`}>
                        <a>Duplicate</a>
                    </Link>
                    &nbsp;|&nbsp;
                    <Link
                        href={`/list-tokens?chain=${encodeURIComponent(props.chain)}&status=3`}>
                        <a>Fake/Bad/Not Usable</a>
                    </Link>
                </h3>
                <main>
                    <SortableTable
                        key={`token_list_${props.chain}_${props.status}`}
                        caption=""
                        data={props.tokens}
                        columns={columns}
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
