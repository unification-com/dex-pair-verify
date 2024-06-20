import React from "react"
import { GetServerSideProps} from "next"
import Layout from "../components/Layout"
import prisma from '../lib/prisma';
import Status from "../components/Status";
import Link from "next/link";
import Router from "next/router";
import ChainName from "../components/ChainName";
import DexName from "../components/DexName";

export const getServerSideProps: GetServerSideProps = async ({ params, query }) => {
    const pairs = await prisma.pair.findMany({
        where: {
            chain: String(query?.chain),
            dex: String(query?.dex),
            status: Number(query?.status || 0),
        },
        include: {
            token0: {
                select: { symbol: true, id: true, contractAddress: true, status: true },
            },
            token1: {
                select: { symbol: true, id: true, contractAddress: true, status: true },
            },
        },
        orderBy: [
            {
                reserveNativeCurrency: 'desc',
            },
        ],
    });
    return {
        props: {
            pairs,
            chain: String(query?.chain),
            dex: String(query?.dex),
            status: Number(query?.status || 0)
        },
    };
}

type Props = {
    pairs: any,
    chain: string,
    dex: string,
    status: number,
}

const ListPairs: React.FC<Props> = (props) => {
    return (
        <Layout>
            <div className="page">
                <h1><Status status={props.status}/> Pairs</h1>
                <h2>
                    Chain: <ChainName chain={props.chain}/><br />
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
                        <a>Fake/Dupe</a>
                    </Link>
                </h3>
                <main>
                    <table>
                        <thead>
                        <tr>
                            <th>Pair</th>
                            <th>Token 0</th>
                            <th>(Token 0 Status)</th>
                            <th>Token 1</th>
                            <th>(Token 1 Status)</th>
                            <th>Verification Method</th>
                            <th></th>
                        </tr>
                        </thead>
                        <tbody>
                        {props.pairs.map((pair) => (
                            <tr key={pair.id} className="pair">
                                <td>{pair.pair}</td>
                                <td><strong>{pair.token0.symbol}</strong></td>
                                <td><Status status={pair.token0.status}/></td>
                                <td><strong>{pair.token1.symbol}</strong></td>
                                <td><Status status={pair.token1.status}/></td>
                                <td>{pair.verificationMethod}</td>
                                <td>
                                    <button onClick={() => Router.push("/p/[id]", `/p/${pair.id}`)}>
                                        <strong>Edit Pair</strong>
                                    </button>
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>

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
