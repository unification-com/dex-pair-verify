import formidable from "formidable";
import {getServerSession} from "next-auth";

import {authOptions} from "./auth/[...nextauth]";
import prisma from '../../lib/prisma';
import {ExtendedSessionUser} from "../../types/types";

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

    const session = await getServerSession(req, res, authOptions)

    if (!(session.user as ExtendedSessionUser).isAuthorised) {
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

    const pair = await prisma.pair.update({
        where: {
            id: fields.pairid[0]
        },
        data: {
            status: parseInt(fields.status[0]),
            verificationMethod: "manual",
            verificationComment: fields.comment[0],
        },
    })

    return res.status(200).json({ success: true, data: {new_status: pair.status, id: pair.id } })

}
