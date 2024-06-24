import type { NextApiRequest, NextApiResponse } from 'next'
import formidable from "formidable";
import prisma from '../../lib/prisma';

export const config = {
    api: {
        bodyParser: false
    }
};

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {

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
    let updatedPairCount = 0
    let updatedTokenCount = 1;

    const token = await prisma.token.update({
        where: { id: tokenId },
        data: { status: newStatus, verificationMethod: "manual" },
    })

    if(newStatus === 1) {
        // check for duplicate token symbols. Assume this is the correct token, set others to "2"
        // and cascade through pairs

        // first get possible duplicate token symbols
        const duplicateTokens = await prisma.token.findMany({
            where: {
                symbol: token.symbol,
                chain: token.chain,
            }
        })

        for(let i = 0; i < duplicateTokens.length; i += 1) {
            let dt = duplicateTokens[i]
            if(dt.id === tokenId) {
                continue
            }
            dt = await prisma.token.update({
                where: { id: dt.id },
                data: { status: 2, verificationMethod: "cascade" },
            })
            updatedTokenCount += 1

            // pairs using this token
            const updatedPairCountRes = await prisma.pair.updateMany({
                where: {
                    OR: [
                        {
                            token0Id: dt.id
                        },
                        {
                            token1Id: dt.id
                        },
                    ],
                },
                data: { status: 2, verificationMethod: "cascade" },
            })

            updatedPairCount += updatedPairCountRes.count
        }

    } else {
        // status is something other than 1 (verified). Cascade through associated pairs
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
            data: { status: newStatus, verificationMethod: "cascade" },
        })

        updatedPairCount = updatedPairCountRes.count
    }

    return res.status(200).json({ success: true, data: {new_status: token.status, id: token.id, affected_pairs: updatedPairCount, affected_tokens: updatedTokenCount } })

}
