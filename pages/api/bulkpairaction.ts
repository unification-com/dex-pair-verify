import {getServerSession} from "next-auth";

import {authOptions} from "./auth/[...nextauth]";
import prisma from "../../lib/prisma";
import {promoteTokensToVerified} from "../../lib/tokenStatus";
import {runVerdictForPair} from "../../lib/verdictRunner";
import {ExtendedSessionUser, TokenPairStatus, VerificationMethod} from "../../types/types";


import type { NextApiRequest, NextApiResponse } from 'next'

// Bulk-action endpoint for the NeedsReview queue (A.5). approve/reject set an
// operator (Manual*) status across the selected pairs; rescan re-runs the
// verdict engine on each. Manual statuses are operator decisions, so they are
// not subject to R6 (R6 only stops the engine overriding them).
export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    const session = await getServerSession(req, res, authOptions)

    if (!(session.user as ExtendedSessionUser).isAuthorised) {
        return res.status(403).json({ success: false, err: "not authorised" })
    }

    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : []
    const action = String(req.body?.action || "")

    if (ids.length === 0) {
        return res.status(400).json({ success: false, err: "no pairs selected" })
    }

    try {
        if (action === "approve" || action === "reject") {
            const status = action === "approve" ? TokenPairStatus.ManualVerified : TokenPairStatus.ManualRejected
            const result = await prisma.pair.updateMany({
                where: { id: { in: ids } },
                data: {
                    status,
                    verificationMethod: VerificationMethod.Manual,
                    verificationComment: `bulk ${action} by operator`,
                },
            })

            // Approving pairs promotes their tokens too (same as the auto path).
            if (action === "approve") {
                const pairs = await prisma.pair.findMany({ where: { id: { in: ids } }, select: { token0Id: true, token1Id: true } })
                const tokenIds = new Set<string>()
                for (const p of pairs) {
                    tokenIds.add(p.token0Id)
                    tokenIds.add(p.token1Id)
                }
                await promoteTokensToVerified(Array.from(tokenIds))
            }

            return res.status(200).json({ success: true, count: result.count })
        }

        if (action === "rescan") {
            let count = 0
            for (const id of ids) {
                const out = await runVerdictForPair(id)
                if (out.persisted) {
                    count += 1
                }
            }
            return res.status(200).json({ success: true, count })
        }

        return res.status(400).json({ success: false, err: `unknown action: ${action}` })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, err: String(err) })
    }
}
