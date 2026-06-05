import {requireAdminApi} from "../../../lib/apiAuth";
import {countPairsToFactoryCheck, pairsToFactoryCheck, runFactoryCheckForPair} from "../../../lib/factoryCheck";

import type { NextApiRequest, NextApiResponse } from 'next'

// On-chain factory check (T2) over the pair set, one batch per call. The client
// loops, passing back jobStartedAt until `done`. Idempotent + resumable via
// factoryCheckedAt. A factory mismatch routes the pair to Needs Review; a match
// raises confidence. RPC reads are lighter than the GoPlus passes, so batches
// can be larger and the client paces less.
const DEFAULT_BATCH = 20;
const MAX_BATCH = 50;

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (!(await requireAdminApi(req, res))) return;

    const now = Math.floor(Date.now() / 1000)
    const jobStartedAt = Number(req.body?.jobStartedAt) || now
    const batch = Math.min(MAX_BATCH, Math.max(1, Number(req.body?.batch) || DEFAULT_BATCH))

    try {
        const ids = await pairsToFactoryCheck(jobStartedAt, batch)

        let factoriesRead = 0
        let mismatches = 0
        for (const id of ids) {
            const out = await runFactoryCheckForPair(id)
            if (out.factoryFound) {
                factoriesRead += 1
            }
            if (out.mismatch) {
                mismatches += 1
            }
        }

        const remaining = await countPairsToFactoryCheck(jobStartedAt)

        return res.status(200).json({
            success: true,
            data: {
                jobStartedAt,
                processed: ids.length,
                factoriesRead,
                mismatches,
                remaining,
                done: remaining === 0,
            },
        })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, err: String(err) })
    }
}
