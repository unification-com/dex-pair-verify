import React from "react"
import { GetServerSideProps} from "next"
import Layout from "../components/Layout"
import prisma from '../lib/prisma';
import Status from "../components/Status";
import Link from "next/link";
import Router from "next/router";

export const getServerSideProps: GetServerSideProps = async ({ params, query }) => {
    const tokens = await prisma.token.findMany({
        where: {
            chain: String(query?.chain),
            status: Number(query?.status || 0),
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
            status: Number(query?.status || 0)
        },
    };
}

type Props = {
    tokens: any,
    chain: string,
    status: number,
}

const ListTokens: React.FC<Props> = (props) => {
    return (
        <Layout>
            <div className="page">
                <h1><Status status={props.status} /> Tokens</h1>
                <h2>Chain: {props.chain}</h2>
                <h3>
                    <Link
                        href={`/list-tokens?chain=${encodeURIComponent(props.chain)}&status=0`}>
                        <a>Unverified</a>
                    </Link>
                    &nbsp;|&nbsp;
                    <Link
                        href={`/list-tokens?chain=${encodeURIComponent(props.chain)}&status=1`}>
                        <a>Good</a>
                    </Link>
                    &nbsp;|&nbsp;
                    <Link
                        href={`/list-tokens?chain=${encodeURIComponent(props.chain)}&status=2`}>
                        <a>Bad</a>
                    </Link>
                </h3>
                <main>
                    <table>
                        <thead>
                        <tr>
                            <th>Symbol</th>
                            <th>Name</th>
                            <th>Verification Method</th>
                            <th></th>
                        </tr>
                        </thead>
                        <tbody>
                        {props.tokens.map((token) => (
                            <tr key={token.id} className="token">
                                <td><strong>{token.symbol}</strong></td>
                                <td>{token.name}</td>
                                <td>{token.verificationMethod}</td>
                                <td>
                                    <button onClick={() => Router.push("/t/[id]", `/t/${token.id}`)}>
                                        <strong>Edit Token</strong>
                                    </button>
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
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
