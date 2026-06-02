import {getServerSession} from "next-auth";

import {authOptions} from "./auth/[...nextauth]";
import prisma from '../../lib/prisma';
import {VERIFIED_STATUSES} from "../../lib/status";
import {ExtendedSessionUser} from "../../types/types";

import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {

    const session = await getServerSession(req, res, authOptions)

    if (!(session.user as ExtendedSessionUser).isAuthorised) {
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
            status: { in: [...VERIFIED_STATUSES] },
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
        res.setHeader(`Content-Disposition`, `attachment; filename=${chain}-${dex}-verified.json`);
    }

    return res.status(200).json(retData)

}
