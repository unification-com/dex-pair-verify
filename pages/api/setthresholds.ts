import type { NextApiRequest, NextApiResponse } from 'next'
import formidable from "formidable";
import prisma from '../../lib/prisma';
import {ExtendedSessionUser} from "../../types/types";
import {getServerSession} from "next-auth";
import {authOptions} from "./auth/[...nextauth]";

export const config = {
    api: {
        bodyParser: false
    }
};

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {

    const session = await getServerSession(req, res, authOptions)

    if (!(session.user as ExtendedSessionUser).isAuthotised) {
        return res.status(403).json({ success: false, err: "not authorised" })
    }

    const form = formidable({});
    let fields;
    try {
        [fields] = await form.parse(req);
    } catch (err) {
        console.error(err);
        return res.status(400).json({ success: false, err: err })
    }

    const threshold = await prisma.threshold.update({
        where: {
            id: fields.thresholdid[0],
        },
        data: {
            minLiquidityUsd: parseInt(fields.min_liquidity[0]),
            minTxCount: parseInt(fields.min_tx_count[0]),
        },
    })

    return res.status(200).json(
        {
            success: true,
            data: {
                id: threshold.id,
                new_min_liquidity: threshold.minLiquidityUsd,
                new_min_tx_count: threshold.minTxCount,
            }
        }
    )
}
