import React, {FormEvent, useState} from "react"
import { GetServerSideProps } from "next"
import Layout from "../../components/Layout"
import prisma from '../../lib/prisma';
import Link from "next/link";

import {NotificationManager} from 'react-notifications';
import Status from "../../components/Status";
import {TokenProps} from "../../types/props";
import ChainName from "../../components/ChainName";
import ExplorerUrl from "../../components/ExplorerUrl";
import {NumericFormat} from "react-number-format";


export const getServerSideProps: GetServerSideProps = async ({ params }) => {

    const token = await prisma.token.findUnique({
        where: {
            id: String(params?.id),
        },
        include: {
            pairsToken0: {
                select: { pair: true, id: true, contractAddress: true, status: true },
            },
            pairsToken1: {
                select: { pair: true, id: true, contractAddress: true, status: true },
            },
        },
    });

    const duplicates = await prisma.token.findMany({
        where: {
            chain: token.chain,
            symbol: token.symbol,
            id: {
                not: token.id,
            }
        },
    });

    return {
        props: {token, duplicates},
    }
}

type Props = {
    token: TokenProps;
    duplicates: TokenProps[];
}

const Token: React.FC<Props> = (props) => {

    const [currentStatus, setCurrentStatus] = useState(props.token.status)

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()

        const formData = new FormData(event.currentTarget)
        const response = await fetch('/api/settokenstatus', {
            method: 'POST',
            body: formData,
        })

        // Handle response if necessary
        const res = await response.json()
        if(res.success) {
            NotificationManager.success("Success!", `Status changed to ${res.data.new_status}`, 5000);
            setCurrentStatus(res.data.new_status)
        } else {
            NotificationManager.error("Error", `${res.err}`, 5000)
        }

    }

    return (
        <Layout>
            <div>
                <h1>Token</h1>
                <h2>{props.token.symbol} (<ChainName chain={props.token.chain}/>)</h2>
                <p>Name: {props.token.name}</p>
                <p>Explorer: &nbsp;
                    <ExplorerUrl chain={props.token.chain} contractAddress={props.token.contractAddress} linkType={"token"}/>
                </p>
                <p>
                    Tx Count: <NumericFormat displayType="text" thousandSeparator="," value={props.token.txCount}/>
                </p>
                <p>Status: <Status status={currentStatus}/></p>
                Change Status: <form onSubmit={onSubmit}>
                <select name="status" id="tokenstatus">
                    <option value="0">Unverified</option>
                    <option value="1">Good</option>
                    <option value="2">Bad</option>
                </select>
                <input type={"hidden"} value={props.token.id} name={"tokenid"}/>
                <button type="submit">Submit</button>
            </form>

                <p><strong>Note:</strong> Setting the token status to "BAD" will automatically set the status of ALL
                    associated pairs to BAD</p>

                {
                    (props.duplicates.length) > 0 &&
                    <>
                      <h4>Possible Duplicates</h4>
                        <ul>
                        {props.duplicates.map((dupe) => (
                            <>
                                <li key={dupe.id}>
                                    <Link
                                        href={`/t/${dupe.id}`}>
                                        {dupe.symbol}
                                    </Link>
                                </li>
                            </>
                        ))}
                        </ul>
                    </>
                }

                <h4>Associated Pairs</h4>
                <ul>
                    {props.token.pairsToken0 && props.token.pairsToken0.map((pairToken0) => (
                        <li key={pairToken0.id}>
                            <a
                                href={`/p/${pairToken0.id}`}>
                                {pairToken0.pair}
                            </a>
                        </li>
                    ))}
                    {props.token.pairsToken1 && props.token.pairsToken1.map((pairToken1) => (
                        <li key={pairToken1.id}>
                            <Link
                                href={`/p/${pairToken1.id}`}>
                                {pairToken1.pair}
                            </Link>
                        </li>
                    ))}
                </ul>

            </div>
        </Layout>
    )
}

export default Token;
