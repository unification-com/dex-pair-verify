import {getServerSession} from "next-auth";

import {authOptions} from "./auth/[...nextauth]";
import {runVerdictForPair} from "../../lib/verdictRunner";
import {ExtendedSessionUser} from "../../types/types";

import type { NextApiRequest, NextApiResponse } from 'next'

// Operator-triggered re-run of the verdict engine for a single pair. Thin
// wrapper over runVerdictForPair (the same core the ingest + cron use). Honours
// R6 — a Manual* status is reported back as skipped, never overwritten.
export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    const session = await getServerSession(req, res, authOptions)

    if (!(session.user as ExtendedSessionUser).isAuthorised) {
        return res.status(403).json({ success: false, err: "not authorised" })
    }

    const pairId = req.body?.pairid
    if (!pairId) {
        return res.status(400).json({ success: false, err: "pairid required" })
    }

    try {
        const out = await runVerdictForPair(String(pairId))

        if (!out.found) {
            return res.status(404).json({ success: false, err: "pair not found" })
        }
        if (out.skippedManual) {
            return res.status(200).json({ success: true, data: { skipped: true, message: "Manual status — not overridden" } })
        }

        return res.status(200).json({
            success: true,
            data: {
                skipped: false,
                new_status: out.result.verdict,
                confidence: out.result.confidence,
                reason: out.result.reason,
            },
        })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, err: String(err) })
    }
}
