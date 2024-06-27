import React from "react"
import { GetServerSideProps } from "next"
import Layout from "../../../../components/Layout"
import prisma from '../../../../lib/prisma';
import {PairProps} from "../../../../types/props";
import SortableTable from "../../../../components/SortableTable/SortableTable";
import Status from "../../../../components/Status";
import PriceTest from "../../../../components/PriceTest/PriceTest";

export const getServerSideProps: GetServerSideProps = async ({ params }) => {

    const minReserveUsd = 50000

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
            status: 1,
        },
    });

    const usablePairs = []
    const ignoredPairs = []
    const contactList = {}

    for(let i = 0; i < pairs.length; i += 1) {
        const p = pairs[i]

        if(p.reserveUsd >= minReserveUsd) {
            usablePairs.push(p)

            if(contactList[p.chain] === undefined) {
                contactList[p.chain] = {}
            }

            if(contactList[p.chain][p.dex] === undefined) {
                contactList[p.chain][p.dex] = []
            }
            contactList[p.chain][p.dex].push(p.contractAddress)
        } else {
            ignoredPairs.push(p)
        }
    }

    return {
        props: {pair, base: pair.token0.symbol, target: pair.token1.symbol, usablePairs, ignoredPairs, minReserveUsd, contactList},
    }
}

type Props = {
    pair: PairProps,
    base: string,
    target: string,
    usablePairs: PairProps[];
    ignoredPairs: PairProps[];
    minReserveUsd: number;
    contactList: object;
}

const Pair: React.FC<Props> = (props) => {

    if(props.pair.status !== 1) {
        return (
            <Layout>
                <h3>Pair "{props.pair.pair}" status is <Status status={props.pair.status} method={""} />. Please try another</h3>
            </Layout>
        )
    }

    return (
        <Layout>
            <PriceTest
                key={`${props.base}_${props.target}_${Date.now()}`}
                base={props.base}
                target={props.target}
                usablePairs={props.usablePairs}
                ignoredPairs={props.ignoredPairs}
                minReserveUsd={props.minReserveUsd}
            />
        </Layout>
    )
}

export default Pair
