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

    const token = await prisma.token.update({
        where: { id: fields.tokenid[0] },
        data: { status: newStatus, verificationMethod: "manual" },
    })

    // also update pairs, if the status is set to unverified, duplicate or fake/bad
    if(newStatus !== 1) {
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
            data: { status: newStatus, verificationMethod: "manual" },
        })

        updatedPairCount = updatedPairCountRes.count
    }

    return res.status(200).json({ success: true, data: {new_status: token.status, id: token.id, affected_pairs: updatedPairCount } })

}
