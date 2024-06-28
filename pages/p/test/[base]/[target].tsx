import React, {useEffect, useState} from "react"
import { GetServerSideProps } from "next"
import Layout from "../../../../components/Layout"
import prisma from '../../../../lib/prisma';
import {PairProps} from "../../../../types/props";
import SortableTable from "../../../../components/SortableTable/SortableTable";
import Status from "../../../../components/Status";
import PriceTest from "../../../../components/PriceTest/PriceTest";

export const getServerSideProps: GetServerSideProps = async ({ params }) => {

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

    return {
        props: {base, target, pairs},
    }
}

type Props = {
    base: string,
    target: string,
    pairs: PairProps[];
}

const Pair: React.FC<Props> = (props) => {

    const [minReserveUsd, setMinReserveUsd] = useState(50000)
    const [minReserveUsdInput, setMinReserveUsdInput] = useState(50000)
    const [usablePairs, setUsablePairs] = useState([])
    const [ignoredPairs, setIgnoredPairs] = useState([])

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
                <h3>No usable <Status status={1} method={""} /> pairs found for {props.base}-{props.target}. Please try another</h3>
            </Layout>
        )
    }

    return (
        <Layout>

            <h3>
                <form onSubmit={handleMinReserveChange}>
                Only <Status status={1} method={""}/> pairs are used, with a USD reserve &gt;= $
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
