import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../lib/prisma';
import {getServerSession} from "next-auth";
import {authOptions} from "./auth/[...nextauth]";
import {ExtendedSessionUser} from "../../types/types";

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {

    const nav = {dexs: [], chains: []}

    const session = await getServerSession(req, res, authOptions)

    if (!(session.user as ExtendedSessionUser).isAuthotised) {
        return res.status(403).json(nav)
    }

    const data = await prisma.pair.findMany({
        distinct: ['chain', 'dex'],
    })

    for(let i = 0; i < data.length; i += 1) {
        const d = data[i]
        if(!nav.chains.includes(d.chain)) {
            nav.chains.push(d.chain)
        }
        nav.dexs.push({
            c: d.chain,
            d: d.dex,
        })
    }


    return res.status(200).json(nav)

}
