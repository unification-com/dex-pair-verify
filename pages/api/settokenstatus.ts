import type { NextApiRequest, NextApiResponse } from 'next'
import formidable from "formidable";
import prisma from '../../lib/prisma';
import {useSession} from "next-auth/react";
import {ExtendedSessionUser, TokenPairStatus} from "../../types/types";
import {getServerSession} from "next-auth";
import { authOptions } from "./auth/[...nextauth]"

export const config = {
    api: {
        bodyParser: false
    }
};

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {

    const session = await getServerSession(req, res, authOptions)

    if (!(session.user as ExtendedSessionUser).isAuthotised) {
        return res.status(403).json({ success: false, err: "not authorised" })
    }

    const form = formidable({});
    let fields;
    try {
        [fields] = await form.parse(req);
    } catch (err) {
        console.error(err);
        return res.status(400).json({ success: false, err: err })
    }

    const newStatus = parseInt(fields.status[0])
    const tokenId = fields.tokenid[0]
    const comment = fields.comment[0]
    let updatedPairCount = 0
    let updatedTokenCount = 1;

    const token = await prisma.token.update({
        where: { id: tokenId },
        data: {
            status: newStatus,
            verificationMethod: "manual",
            verificationComment: comment,
        },
    })

    if(newStatus !== TokenPairStatus.Verified) {
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
                verificationMethod: "cascade"
            },
        })

        updatedPairCount = updatedPairCountRes.count
    }

    return res.status(200).json({ success: true, data: {new_status: token.status, id: token.id, affected_pairs: updatedPairCount, affected_tokens: updatedTokenCount } })

}
