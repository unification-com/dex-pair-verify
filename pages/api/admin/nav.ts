import {requireAdminApi} from "../../../lib/apiAuth";
import prisma from '../../../lib/prisma';

import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {

    if (!(await requireAdminApi(req, res))) return;

    const nav = {dexs: [], chains: []}

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
