import {buildExportIndex} from "../../../../lib/export";
import {checkBearerToken, parseBearer, tokenPrefix} from "../../../../lib/exportAuth";
import {rateLimit} from "../../../../lib/rateLimit";

import type { NextApiRequest, NextApiResponse } from 'next'

// Bearer-token discovery manifest (A.6.2): which (chain, dex) exports exist,
// their pair counts + last-updated + URL. Lets go-ooo discover what to poll
// without a hardcoded source list. Lives at /api/ooo/export/manifest alongside
// the per-(chain,dex) bearer export.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    const started = Date.now()

    if (!checkBearerToken(req)) {
        return res.status(401).json({ error: "unauthorised" })
    }

    const token = parseBearer(req.headers.authorization)
    if (!rateLimit(token ?? "anon", RATE_LIMIT, RATE_WINDOW_MS, started)) {
        return res.status(429).json({ error: "rate limit exceeded" })
    }

    try {
        const data = await buildExportIndex()
        const dexCount = data.chains.reduce((n, c) => n + c.dexs.length, 0)
        console.log(JSON.stringify({ export: "manifest", token: tokenPrefix(token), chains: data.chains.length, dexs: dexCount, ms: Date.now() - started }))
        return res.status(200).json(data)
    } catch (err) {
        console.error(err)
        return res.status(500).json({ error: String(err) })
    }
}
