import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../lib/prisma';
import {getServerSession} from "next-auth";
import {authOptions} from "./auth/[...nextauth]";
import {ExtendedSessionUser} from "../../types/types";

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

    const data = await prisma.pair.findMany({
        where: {
            chain,
            dex,
            status: 1,
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

    const retData = {
        pairs: [],
        chain,
        dex,
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
        res.setHeader(`Content-Disposition`, `attachment; filename=${chain}_${dex}_verified.json`);
    }

    return res.status(200).json(retData)

}
