import {getServerSession} from "next-auth";

import prisma from "../../../lib/prisma";
import {ExtendedSessionUser} from "../../../types/types";
import {authOptions} from "../auth/[...nextauth]";

import type { NextApiRequest, NextApiResponse } from 'next'

const toInt = (v: unknown, fallback: number): number => {
    const n = parseInt(String(v), 10)
    return Number.isFinite(n) ? n : fallback
}
const toFloat = (v: unknown, fallback: number): number => {
    const n = parseFloat(String(v))
    return Number.isFinite(n) ? n : fallback
}

// Full per-(chain,dex) threshold save for the threshold matrix page (A.3).
export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    const session = await getServerSession(req, res, authOptions)

    if (!(session.user as ExtendedSessionUser).isAuthorised) {
        return res.status(403).json({ success: false, err: "not authorised" })
    }

    const b = req.body || {}
    if (!b.id) {
        return res.status(400).json({ success: false, err: "id required" })
    }

    try {
        const threshold = await prisma.threshold.update({
            where: { id: String(b.id) },
            data: {
                minLiquidityUsd: toInt(b.minLiquidityUsd, 0),
                minTxCount: toInt(b.minTxCount, 0),
                minAgeHours: toInt(b.minAgeHours, 24),
                maxPriceDeviationPercent: toFloat(b.maxPriceDeviationPercent, 5),
                minDecimals: toInt(b.minDecimals, 0),
                maxDecimals: toInt(b.maxDecimals, 36),
                requireCgListed: Boolean(b.requireCgListed),
                hardMinLiquidityUsd: toInt(b.hardMinLiquidityUsd, 500),
                autoVerifyConfidence: toFloat(b.autoVerifyConfidence, 0.85),
            },
        })
        return res.status(200).json({ success: true, data: threshold })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, err: String(err) })
    }
}
