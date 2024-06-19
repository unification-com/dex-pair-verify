import React, {FormEvent, useState} from "react"
import { GetServerSideProps } from "next"
import Layout from "../../components/Layout"
import prisma from '../../lib/prisma';
import Link from "next/link";

import {NotificationManager} from 'react-notifications';
import Status from "../../components/Status";


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
    return {
        props: token,
    }
}

type AssociatedPairProps = {
    id: string;
    pair: string;
    contractAddress: string;
    status: number;
}

type TokenProps = {
    id: string;
    chain: string;
    contractAddress: string;
    symbol: string;
    name: string;
    status: number;
    pairsToken0: AssociatedPairProps[] | null;
    pairsToken1: AssociatedPairProps[] | null;
};

const Token: React.FC<TokenProps> = (props) => {

    const [currentStatus, setCurrentStatus] = useState(props.status)

    const explorerUrls = {
        eth: "https://etherscan.io",
        bsc: "https://bscscan.com",
        polygon: "https://polygonscan.com",
        gnosis: "https://gnosis.blockscout.com",
        xdai: "https://gnosis.blockscout.com",
    }

    const chainNames = {
        eth: "Ethereum",
        bsc: "BSC",
        polygon: "Polygon",
        xdai: "Gnosis"
    }

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

    const explorer = explorerUrls[props.chain]
    const chainName = chainNames[props.chain]

    return (
        <Layout>
            <div>
                <h1>Token</h1>
                <h2>{props.symbol} ({chainName})</h2>
                <p>Name: {props.name}</p>
                <p>Contract: &nbsp;
                    <Link href={`${explorer}/token/${props.contractAddress}`}>
                        <a target="_blank">{props.contractAddress}</a>
                    </Link>
                </p>
                <p>Status: <Status status={currentStatus} /></p>
                Change Status: <form onSubmit={onSubmit}>
                    <select name="status" id="tokenstatus">
                        <option value="0">Unverified</option>
                        <option value="1">Good</option>
                        <option value="2">Bad</option>
                    </select>
                    <input type={"hidden"} value={props.id} name={"tokenid"}/>
                    <button type="submit">Submit</button>
                </form>

                <p><strong>Note:</strong> Setting the token status to "BAD" will automatically set the status of ALL
                associated pairs to BAD</p>

                <h4>Associated Pairs</h4>
                <ul>
                    {props.pairsToken0 && props.pairsToken0.map((pairToken0) => (
                        <li key={pairToken0.id}>
                            {pairToken0.pair}
                        </li>
                    ))}
                    {props.pairsToken1 && props.pairsToken1.map((pairToken1) => (
                        <li key={pairToken1.id}>
                            {pairToken1.pair}
                        </li>
                    ))}
                </ul>

            </div>
        </Layout>
    )
}

export default Token;
