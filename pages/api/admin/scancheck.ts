import {getServerSession} from "next-auth";

import {countTokensToScamCheck, runScamCheckForToken, tokensToScamCheck} from "../../../lib/scamCheck";
import {ExtendedSessionUser} from "../../../types/types";
import {authOptions} from "../auth/[...nextauth]";

import type { NextApiRequest, NextApiResponse } from 'next'

// GoPlus scam check over the verified-token set, one batch per call. The client
// loops, passing back jobStartedAt until `done`. Batches are small (GoPlus free
// tier is 30 req/min) and the client paces between calls. Idempotent + resumable
// via scamCheckedAt.
const DEFAULT_BATCH = 10;
const MAX_BATCH = 30;

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    const session = await getServerSession(req, res, authOptions)

    if (!(session.user as ExtendedSessionUser).isAuthorised) {
        return res.status(403).json({ success: false, err: "not authorised" })
    }

    const now = Math.floor(Date.now() / 1000)
    const jobStartedAt = Number(req.body?.jobStartedAt) || now
    const batch = Math.min(MAX_BATCH, Math.max(1, Number(req.body?.batch) || DEFAULT_BATCH))

    try {
        const ids = await tokensToScamCheck(jobStartedAt, batch)

        let flagged = 0
        let demotedPairs = 0
        for (const id of ids) {
            const out = await runScamCheckForToken(id)
            if (out.flagged) {
                flagged += 1
            }
            demotedPairs += out.demotedPairs
        }

        const remaining = await countTokensToScamCheck(jobStartedAt)

        return res.status(200).json({
            success: true,
            data: {
                jobStartedAt,
                processed: ids.length,
                flagged,
                demotedPairs,
                remaining,
                done: remaining === 0,
            },
        })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, err: String(err) })
    }
}
