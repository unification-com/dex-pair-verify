import formidable from "formidable";

import {requireAdminApi} from "../../../lib/apiAuth";
import prisma from '../../../lib/prisma';
import {isVerifiedStatus} from "../../../lib/status";
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

    if (!(await requireAdminApi(req, res))) return;

    const form = formidable({});
    let fields;
    try {
        [fields] = await form.parse(req);
    } catch (err) {
        console.error(err);
        return res.status(400).json({ success: false, err: err })
    }

    const pair = await prisma.pair.update({
        where: {
            id: fields.pairid[0]
        },
        data: {
            status: fields.status[0] as TokenPairStatus,
            verificationMethod: VerificationMethod.Manual,
            verificationComment: fields.comment[0],
        },
    })

    // A manually-verified pair promotes its tokens too (same as the auto path).
    if (isVerifiedStatus(pair.status as TokenPairStatus)) {
        await promoteTokensToVerified([pair.token0Id, pair.token1Id])
    }

    return res.status(200).json({ success: true, data: {new_status: pair.status, id: pair.id } })

}
