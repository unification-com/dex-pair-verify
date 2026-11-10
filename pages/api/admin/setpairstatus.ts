import { formidable } from "formidable";

import {requireAdminApi} from "../../../lib/apiAuth";
import prisma from '../../../lib/prisma';
import {isStatus, isVerifiedStatus, statusData} from "../../../lib/status";
import {nowSeconds} from "../../../lib/time";
import {promoteTokensToVerified} from "../../../lib/tokenStatus";
import {TokenPairStatus, VerificationMethod} from "../../../types/types";

import type { NextApiRequest, NextApiResponse } from 'next'

export const config = {
    api: {
        bodyParser: false
    }
};

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {

    if (!(await requireAdminApi(req, res, { methods: ["POST"] }))) return;

    const form = formidable({});
    let fields;
    try {
        [fields] = await form.parse(req);
    } catch (err) {
        console.error(err);
        return res.status(400).json({ success: false, err: err })
    }

    // Validate the form fields before they reach Prisma: a missing pairid or an
    // unrecognised status would otherwise throw (a missing array index / a bad
    // enum) and surface as an unhandled 500.
    const pairid = fields.pairid?.[0];
    const status = fields.status?.[0];
    const comment = fields.comment?.[0] ?? "";
    if (!pairid || !isStatus(status)) {
        return res.status(400).json({ success: false, err: "pairid and a valid status are required" })
    }

    try {
        // The current status, so statusChangedAt only moves on a real change.
        const prev = await prisma.pair.findUniqueOrThrow({ where: { id: pairid }, select: { status: true } })
        const now = nowSeconds()
        const pair = await prisma.pair.update({
            where: { id: pairid },
            data: {
                ...statusData(prev.status, status, now),
                verificationMethod: VerificationMethod.Manual,
                verificationComment: comment,
            },
        })

        // A manually-verified pair promotes its tokens too (same as the auto path).
        if (isVerifiedStatus(pair.status as TokenPairStatus)) {
            await promoteTokensToVerified([pair.token0Id, pair.token1Id], now)
        }

        return res.status(200).json({ success: true, data: {new_status: pair.status, id: pair.id } })
    } catch (err) {
        console.error(err);
        return res.status(400).json({ success: false, err: "could not update pair (unknown id?)" })
    }

}
