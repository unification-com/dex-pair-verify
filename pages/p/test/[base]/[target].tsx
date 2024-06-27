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
    const base = String(params?.base)
    const target = String(params?.target)

    const pairs = await prisma.pair.findMany({
        where: {
            OR: [
                {
                    pair: `${base}-${target}`,
                },
                {
                    pair: `${target}-${base}`,
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
        props: {base, target, usablePairs, ignoredPairs, minReserveUsd, contactList},
    }
}

type Props = {
    base: string,
    target: string,
    usablePairs: PairProps[];
    ignoredPairs: PairProps[];
    minReserveUsd: number;
    contactList: object;
}

const Pair: React.FC<Props> = (props) => {

    if(props.usablePairs.length === 0) {
        return (
            <Layout>
                <h3>No usable <Status status={1} method={""} /> pairs found for {props.base}-{props.target}. Please try another</h3>
            </Layout>
        )
    }

    return (
        <Layout>
            <PriceTest
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
