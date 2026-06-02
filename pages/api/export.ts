import {getServerSession} from "next-auth";

import {authOptions} from "./auth/[...nextauth]";
import {buildExportV2} from "../../lib/export";
import {ExtendedSessionUser} from "../../types/types";


import type { NextApiRequest, NextApiResponse } from 'next'

// Session-gated manual export (the GitHub-upload path). Operator clicks "Export
// Verified", downloads the JSON, commits it to the GitHub repo go-ooo polls.
// Emits the same v2 shape as the bearer-token API endpoint (lib/export.ts) so
// the two paths stay identical.
export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {

    const session = await getServerSession(req, res, authOptions)

    if (!(session.user as ExtendedSessionUser).isAuthorised) {
        return res.status(403).json("not authorised")
    }

    if(!req.query?.chain || !req.query?.dex) {
        return res.status(400).json("Chain and dex required")
    }

    const chain = String(req.query?.chain)
    const dex = String(req.query?.dex)
    const download = String(req.query?.download)

    const retData = await buildExportV2(chain, dex)

    if(parseInt(download) === 1) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader(`Content-Disposition`, `attachment; filename=${chain}-${dex}-verified.json`);
    }

    return res.status(200).json(retData)

}
