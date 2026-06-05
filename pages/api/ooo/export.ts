import {requireAdminApi} from "../../../lib/apiAuth";
import {buildExportV2} from "../../../lib/export";

import type { NextApiRequest, NextApiResponse } from 'next'

// Session-gated manual export (the GitHub-upload path). Operator clicks "Export
// Verified", downloads the JSON, commits it to the GitHub repo go-ooo polls.
// Emits the same shape as the bearer-token API endpoint (the shared
// lib/export.ts builder) so the two paths stay identical.
export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {

    if (!(await requireAdminApi(req, res))) return;

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
