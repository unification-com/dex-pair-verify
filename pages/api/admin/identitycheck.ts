import {requireAdminApi} from "../../../lib/apiAuth";
import {countTokensToIdentityCheck, runIdentityCheckForToken, tokensToIdentityCheck} from "../../../lib/identityCheck";

import type { NextApiRequest, NextApiResponse } from 'next'

// Multi-source identity check (T1) over the no-cgId pair tokens, one batch per
// call. The client loops, passing back jobStartedAt until `done`. Batches are
// small (GoPlus free tier is 30 req/min) and the client paces between calls.
// Idempotent + resumable via identityCheckedAt. A confirmed token re-runs the
// verdict on its pairs, so newly-identified pairs leave Needs Review inline.
const DEFAULT_BATCH = 10;
const MAX_BATCH = 30;

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (!(await requireAdminApi(req, res, { methods: ["POST"] }))) return;

    const now = Math.floor(Date.now() / 1000)
    const jobStartedAt = Number(req.body?.jobStartedAt) || now
    const batch = Math.min(MAX_BATCH, Math.max(1, Number(req.body?.batch) || DEFAULT_BATCH))

    try {
        const ids = await tokensToIdentityCheck(jobStartedAt, batch)

        let confirmed = 0
        let promotedPairs = 0
        for (const id of ids) {
            const out = await runIdentityCheckForToken(id)
            if (out.confirmed) {
                confirmed += 1
            }
            promotedPairs += out.promotedPairs
        }

        const remaining = await countTokensToIdentityCheck(jobStartedAt)

        return res.status(200).json({
            success: true,
            data: {
                jobStartedAt,
                processed: ids.length,
                confirmed,
                promotedPairs,
                remaining,
                done: remaining === 0,
            },
        })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, err: String(err) })
    }
}
