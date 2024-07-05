import React, {FormEvent, useEffect, useState} from "react"
import { GetServerSideProps } from "next"
import Layout from "../../../../components/Layout"
import prisma from '../../../../lib/prisma';
import {PairProps} from "../../../../types/props";
import {NotificationManager} from 'react-notifications';
import Status from "../../../../components/Status";
import PriceTest from "../../../../components/PriceTest/PriceTest";
import {TokenPairStatus} from "../../../../types/types";

export const getServerSideProps: GetServerSideProps = async ({ params }) => {

    const pair = await prisma.pair.findUnique({
        where: {
            id: String(params?.id),
        },
        include: {
            token0: {
                select: { symbol: true, id: true, contractAddress: true, txCount: true, status: true, coingeckoCoinId: true },
            },
            token1: {
                select: { symbol: true, id: true, contractAddress: true, txCount: true, status: true, coingeckoCoinId: true },
            },
        },
    });

    const pairs = await prisma.pair.findMany({
        where: {
            OR: [
                {
                    pair: `${pair.token0.symbol}-${pair.token1.symbol}`,
                },
                {
                    pair: `${pair.token1.symbol}-${pair.token0.symbol}`,
                }
            ],
            status: TokenPairStatus.Verified,
        },
    });

    const thresholds = {}

    for(let i = 0; i < pairs.length; i++) {
        const chain = pairs[i].chain
        const dex = pairs[i].dex

        const thresholdsDb = await prisma.threshold.findFirst({
            where: {
                chain,
                dex
            }
        })

        if(thresholds[chain] === undefined) {
            thresholds[chain] = {}
        }
        if(thresholds[chain][dex] === undefined) {
            thresholds[chain][dex] = {
                id: thresholdsDb.id,
                minReserveUsd: thresholdsDb.minLiquidityUsd,
                minTxCount: thresholdsDb.minTxCount,
            }
        }
    }

    return {
        props: {pair, base: pair.token0.symbol, target: pair.token1.symbol, pairs, thresholds},
    }
}

type Props = {
    pair: PairProps,
    base: string,
    target: string,
    pairs: PairProps[];
    thresholds: object
}

const Pair: React.FC<Props> = (props) => {

    const [thresholds, setThresholds] = useState(null)
    const [usablePairs, setUsablePairs] = useState([])
    const [ignoredPairs, setIgnoredPairs] = useState([])

    useEffect(() => {
        setThresholds(props.thresholds)
    }, [])

    if (props.pair.status !== TokenPairStatus.Verified) {
        return (
            <Layout>
                <h3>Pair "{props.pair.pair}" status is <Status status={props.pair.status} method={""}/>. Please try
                    another</h3>
            </Layout>
        )
    }

    useEffect(() => {
        const up = []
        const ip = []

        if(thresholds !== null) {
            for (let i = 0; i < props.pairs.length; i += 1) {
                const p = props.pairs[i]

                if (p.reserveUsd >= thresholds[p.chain][p.dex].minReserveUsd && p.txCount >= thresholds[p.chain][p.dex].minTxCount) {
                    up.push(p)
                } else {
                    ip.push(p)
                }
            }
        }
        setUsablePairs(up)
        setIgnoredPairs(ip)
    }, [thresholds]);

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const newThresholds = {...thresholds}
        const formData = new FormData(event.target as HTMLFormElement);

        const chain = formData.get("chain")
        const dex = formData.get("dex")
        const minLiq = formData.get("min_liquidity")
        const minTxC = formData.get("min_tx_count")
        const saveToDb = formData.get("save_to_db")

        // @ts-ignore
        newThresholds[chain][dex].minReserveUsd = minLiq
        // @ts-ignore
        newThresholds[chain][dex].minTxCount = minTxC

        setThresholds(newThresholds)

        if(saveToDb !== null) {
            const response = await fetch('/api/setthresholds', {
                method: 'POST',
                body: formData,
            })

            // Handle response if necessary
            const res = await response.json()

            if(res.success) {
                NotificationManager.success("Success!", `Min Liquidity changed to $${res.data.new_min_liquidity}, Min Tx count set to ${res.data.new_min_tx_count}`, 5000);
            } else {
                NotificationManager.error("Error", `${res.err}`, 5000)
            }
        }

    }

    let thresholdsTable = <></>

    if(thresholds !== null) {
        thresholdsTable = <>
            Only <Status status={TokenPairStatus.Verified} method={""}/> pairs are used, with a USD reserve and Tx Count
            greater or equal to the values below
            <div className={"divTable"}>
                <div className={"divTableBody"}>
                    <div className={"divTableRow"}>
                        <div className={"divTableCell"}><strong>Chain</strong></div>
                        <div className={"divTableCell"}><strong>Dex</strong></div>
                        <div className={"divTableCell"}><strong>Min Liquidity</strong></div>
                        <div className={"divTableCell"}><strong>Min Tx Count</strong></div>
                        <div className={"divTableCell"}><strong>Save to DB</strong></div>
                        <div className={"divTableCell"}></div>
                    </div>
                    {Object.entries(thresholds).map(([chain, values]) => (
                    Object.entries(thresholds[chain]).map(([dex, t]) => (
                            <form onSubmit={onSubmit} className={"divTableRow"}>
                                <div className={"divTableCell"}>
                                    {chain}
                                </div>
                                <div className={"divTableCell"}>
                                    {dex}
                                </div>
                                <div className={"divTableCell"}>
                                    <input type={"text"} defaultValue={thresholds[chain][dex].minReserveUsd} name={"min_liquidity"}
                                           placeholder={"Minimum Liquidity"} size={9}/>
                                </div>
                                <div className={"divTableCell"}>
                                    <input type={"text"} defaultValue={thresholds[chain][dex].minTxCount} name={"min_tx_count"}
                                           placeholder={"Minimum Tx Count"} size={5} />
                                </div>
                                <div className={"divTableCell"}>
                                    <input type={"checkbox"} defaultValue={1} name={"save_to_db"} />
                                </div>
                                <div className={"divTableCell"}>
                                    <input type={"hidden"} value={chain} name={"chain"}/>
                                    <input type={"hidden"} value={dex} name={"dex"}/>
                                    <input type={"hidden"} value={thresholds[chain][dex].id} name={"thresholdid"}/>
                                    <button type="submit">Save</button>
                                </div>
                            </form>
                    ))
                    ))}
                </div>
            </div>
        </>
    }

    let noUsablePairsWarning = <></>

    if (usablePairs.length === 0) {
        noUsablePairsWarning = <h2>No usable <Status status={TokenPairStatus.Verified} method={""}/> pairs found
            for {props.base}-{props.target} using specified min USD reserve and Tx counts. Please try another, or modify
            respective thresholds</h2>
    }

    return (
        <Layout>
            {thresholdsTable}
            {noUsablePairsWarning}
            <PriceTest
                key={`price_test_${props.base}_${props.target}`}
                base={props.base}
                target={props.target}
                usablePairs={usablePairs}
                ignoredPairs={ignoredPairs}
            />
        </Layout>
    )
}

export default Pair
