import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../lib/prisma';
import {getServerSession} from "next-auth";
import {authOptions} from "./auth/[...nextauth]";
import {ExtendedSessionUser, TokenPairStatus} from "../../types/types";

const cleanseDexId = (dex) => {
    switch(dex) {
        case "pancakeswap-v3-bsc":
            return "pancakeswap_v3"
        default:
            return dex
    }
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {

    const session = await getServerSession(req, res, authOptions)

    if (!(session.user as ExtendedSessionUser).isAuthotised) {
        return res.status(403).json("not authorised")
    }

    if(!req.query?.chain || !req.query?.dex) {
        return res.status(400).json("Chain and dex required")
    }

    const chain = String(req.query?.chain)
    const dex = String(req.query?.dex)
    const download = String(req.query?.download)
    let minLiquidity = 0
    let minTxCount = 0

    let thresholds = await prisma.threshold.findFirst({
        where: {
            chain,
            dex,
        }
    })

    if(thresholds !== null) {
        minLiquidity = thresholds.minLiquidityUsd
        minTxCount = thresholds.minTxCount
    }

    const data = await prisma.pair.findMany({
        where: {
            chain,
            dex,
            status: TokenPairStatus.Verified,
            txCount: {
                gte: minTxCount,
            },
            reserveUsd: {
                gte: minLiquidity,
            },
        },
        include: {
            token0: {
                select: { chain: true, symbol: true, name: true, contractAddress: true },
            },
            token1: {
                select: { chain: true, symbol: true, name: true, contractAddress: true },
            },
        },
        orderBy: [
            {
                reserveUsd: 'desc',
            },
        ],
    })

    const dexIdForOoO = cleanseDexId(dex)

    const retData = {
        pairs: [],
        chain,
        dex: dexIdForOoO,
    }

    for(let i = 0; i < data.length; i += 1) {
        const d = data[i]
        retData.pairs.push(
            {
                contractAddress: d.contractAddress,
                pair: d.pair,
                reserveUsd: d.reserveUsd,
                volumeUsd: d.volumeUsd,
                txCount: d.txCount,
                token0: d.token0,
                token1: d.token1,
            }
        )
    }

    if(parseInt(download) === 1) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader(`Content-Disposition`, `attachment; filename=${chain}-${dexIdForOoO}-verified.json`);
    }

    return res.status(200).json(retData)

}
