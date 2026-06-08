import formidable from "formidable";

import {requireAdminApi} from "../../../lib/apiAuth";
import prisma from '../../../lib/prisma';
import {isStatus} from "../../../lib/status";
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

    // Validate the form fields before they reach Prisma: a missing tokenid or an
    // unrecognised status would otherwise throw and surface as an unhandled 500.
    const newStatus = fields.status?.[0]
    const tokenId = fields.tokenid?.[0]
    const comment = fields.comment?.[0] ?? ""
    if (!tokenId || !isStatus(newStatus)) {
        return res.status(400).json({ success: false, err: "tokenid and a valid status are required" })
    }
    let updatedPairCount = 0
    const updatedTokenCount = 1;

    try {
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
    } catch (err) {
        console.error(err);
        return res.status(400).json({ success: false, err: "could not update token (unknown id?)" })
    }

}
