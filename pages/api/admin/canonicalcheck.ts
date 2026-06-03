import {getServerSession} from "next-auth";

import {countTokensToCanonicalCheck, runCanonicalCheckForToken, tokensToCanonicalCheck} from "../../../lib/canonicalCheck";
import {ExtendedSessionUser} from "../../../types/types";
import {authOptions} from "../auth/[...nextauth]";

import type { NextApiRequest, NextApiResponse } from 'next'

// Proactive canonical-address resolution (T3) over the cgId-bearing pair tokens,
// one batch per call. The client loops, passing back jobStartedAt until `done`.
// Idempotent + resumable via canonicalCheckedAt. A resolved canonical activates
// the impostor fence; a token whose address mismatches is routed to Needs Review.
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
        const ids = await tokensToCanonicalCheck(jobStartedAt, batch)

        let resolved = 0
        let impostorPairs = 0
        for (const id of ids) {
            const out = await runCanonicalCheckForToken(id)
            if (out.hasAddress) {
                resolved += 1
            }
            impostorPairs += out.impostorPairs
        }

        const remaining = await countTokensToCanonicalCheck(jobStartedAt)

        return res.status(200).json({
            success: true,
            data: {
                jobStartedAt,
                processed: ids.length,
                resolved,
                impostorPairs,
                remaining,
                done: remaining === 0,
            },
        })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, err: String(err) })
    }
}
