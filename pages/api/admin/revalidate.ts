import {getServerSession} from "next-auth";

import prisma from "../../../lib/prisma";
import {runVerdictForPair} from "../../../lib/verdictRunner";
import {ExtendedSessionUser, TokenPairStatus} from "../../../types/types";
import {authOptions} from "../auth/[...nextauth]";

import type { NextApiRequest, NextApiResponse } from 'next'

// Cold-start re-evaluation: run the verdict engine across every pair, in
// throttled batches. Idempotent + resumable via `jobStartedAt` — pairs whose
// verdictAt is already >= the job start have been done this job and are
// skipped, so the client can safely loop until `done` (and a restart resumes
// rather than redoing). Manual* pairs are never selected (rule R6).
const MANUAL_STATUSES = [TokenPairStatus.ManualVerified, TokenPairStatus.ManualRejected];
const DEFAULT_BATCH = 25;
const MAX_BATCH = 200;

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    const session = await getServerSession(req, res, authOptions)

    if (!(session.user as ExtendedSessionUser).isAuthorised) {
        return res.status(403).json({ success: false, err: "not authorised" })
    }

    const now = Math.floor(Date.now() / 1000)
    // First call: client omits jobStartedAt; we stamp the job and hand it back.
    const jobStartedAt = Number(req.body?.jobStartedAt) || now
    const batch = Math.min(MAX_BATCH, Math.max(1, Number(req.body?.batch) || DEFAULT_BATCH))

    const where = {
        status: { notIn: MANUAL_STATUSES },
        verdictAt: { lt: jobStartedAt },
    }

    try {
        const pending = await prisma.pair.findMany({ where, select: { id: true }, take: batch })

        const tallies: Record<string, number> = {}
        for (const p of pending) {
            const out = await runVerdictForPair(p.id)
            const key = out.skippedManual ? "skippedManual" : (out.result?.verdict ?? "error")
            tallies[key] = (tallies[key] ?? 0) + 1
        }

        const remaining = await prisma.pair.count({ where })

        return res.status(200).json({
            success: true,
            data: {
                jobStartedAt,
                batch,
                processed: pending.length,
                remaining,
                done: remaining === 0,
                tallies,
            },
        })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, err: String(err) })
    }
}
