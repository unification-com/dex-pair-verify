import formidable from "formidable";

import {requireAdminApi} from "../../../lib/apiAuth";
import prisma from '../../../lib/prisma';
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

    const newStatus = fields.status[0] as TokenPairStatus
    const tokenId = fields.tokenid[0]
    const comment = fields.comment[0]
    let updatedPairCount = 0
    const updatedTokenCount = 1;

    const token = await prisma.token.update({
        where: { id: tokenId },
        data: {
            status: newStatus,
            verificationMethod: VerificationMethod.Manual,
            verificationComment: comment,
        },
    })

    if(newStatus !== TokenPairStatus.ManualVerified) {
        // cascade update associated pairs
        const updatedPairCountRes = await prisma.pair.updateMany({
            where: {
                OR: [
                    {
                        token0Id: tokenId
                    },
                    {
                        token1Id: tokenId
                    },
                ],
            },
            data: {
                status: newStatus,
                verificationMethod: VerificationMethod.Cascade
            },
        })

        updatedPairCount = updatedPairCountRes.count
    }

    return res.status(200).json({ success: true, data: {new_status: token.status, id: token.id, affected_pairs: updatedPairCount, affected_tokens: updatedTokenCount } })

}
