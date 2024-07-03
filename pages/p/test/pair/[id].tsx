import React, {useEffect, useState} from "react"
import { GetServerSideProps } from "next"
import Layout from "../../../../components/Layout"
import prisma from '../../../../lib/prisma';
import {PairProps} from "../../../../types/props";
import SortableTable from "../../../../components/SortableTable/SortableTable";
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

    return {
        props: {pair, base: pair.token0.symbol, target: pair.token1.symbol, pairs},
    }
}

type Props = {
    pair: PairProps,
    base: string,
    target: string,
    pairs: PairProps[];
}

const Pair: React.FC<Props> = (props) => {

    const [minReserveUsd, setMinReserveUsd] = useState(50000)
    const [minReserveUsdInput, setMinReserveUsdInput] = useState(50000)
    const [usablePairs, setUsablePairs] = useState([])
    const [ignoredPairs, setIgnoredPairs] = useState([])

    if(props.pair.status !== TokenPairStatus.Verified) {
        return (
            <Layout>
                <h3>Pair "{props.pair.pair}" status is <Status status={props.pair.status} method={""} />. Please try another</h3>
            </Layout>
        )
    }

    useEffect(() => {
        const up = []
        const ip = []

        for(let i = 0; i < props.pairs.length; i += 1) {
            const p = props.pairs[i]

            if(p.reserveUsd >= minReserveUsd) {
                up.push(p)
            } else {
                ip.push(p)
            }
        }
        setUsablePairs(up)
        setIgnoredPairs(ip)
    }, [minReserveUsd]);

    const onMinReserveUsdChange = (event) => {
        const value = event.target.value;
        setMinReserveUsdInput(parseInt(value))
    }
    const handleMinReserveChange = (event) => {
        event.preventDefault();
        setMinReserveUsd(minReserveUsdInput)
    }

    if(usablePairs.length === 0) {
        return (
            <Layout>
                <h3>No usable <Status status={TokenPairStatus.Verified} method={""} /> pairs found for {props.base}-{props.target}. Please try another</h3>
            </Layout>
        )
    }

    return (
        <Layout>

            <h3>
                <form onSubmit={handleMinReserveChange}>
                    Only <Status status={TokenPairStatus.Verified} method={""}/> pairs are used, with a USD reserve &gt;= $
                    <input type={"text"} defaultValue={minReserveUsdInput} onChange={onMinReserveUsdChange}/>
                    <input type="submit" value="Change Min reserve"/>
                </form>
            </h3>

            <PriceTest
                key={`price_test_${props.base}_${props.target}`}
                base={props.base}
                target={props.target}
                usablePairs={usablePairs}
                ignoredPairs={ignoredPairs}
                minReserveUsd={minReserveUsd}
            />
        </Layout>
    )
}

export default Pair
