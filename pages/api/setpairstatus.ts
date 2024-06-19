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

    const pair = await prisma.pair.update({
        where: { id: fields.pairid[0] },
        data: { status: parseInt(fields.status[0]), verificationMethod: "manual" },
    })

    return res.status(200).json({ success: true, data: {new_status: pair.status, id: pair.id } })

}
