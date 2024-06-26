import type {NextApiRequest, NextApiResponse} from "next";

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {

    if (!req.query?.email) {
        return res.status(400).json({authed: false, error: "email required"})
    }

    const email = String(req.query?.email)

    const allowedArr = process.env.ALLOWED_USERS.split(",")

    if(!allowedArr.includes(email)) {
        return res.status(403).json({authed: false, error: `email ${email} not authorised`})
    }

    return res.status(403).json({authed: true, error: ""})
}
