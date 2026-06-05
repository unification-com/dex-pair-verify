import {buildExportV2, exportLastModified} from "../../../../../lib/export";
import {checkBearerToken, parseBearer, tokenPrefix} from "../../../../../lib/exportAuth";
import {rateLimit} from "../../../../../lib/rateLimit";

import type { NextApiRequest, NextApiResponse } from 'next'

// Bearer-token export for one (chain, dex) — the machine-readable path go-ooo
// polls directly. Supports `?ifModifiedSince=<unix>` for a 304 short-circuit.
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

    const chain = String(req.query.chain)
    const dex = String(req.query.dex)
    const ifModifiedSince = req.query.ifModifiedSince ? Number(req.query.ifModifiedSince) : null

    try {
        if (ifModifiedSince !== null && Number.isFinite(ifModifiedSince)) {
            const last = await exportLastModified(chain, dex)
            if (last <= ifModifiedSince) {
                console.log(JSON.stringify({ export: "pair", token: tokenPrefix(token), chain, dex, status: 304, ms: Date.now() - started }))
                return res.status(304).end()
            }
        }

        const data = await buildExportV2(chain, dex)
        console.log(JSON.stringify({ export: "pair", token: tokenPrefix(token), chain, dex, pairCount: data.pairs.length, ms: Date.now() - started }))
        return res.status(200).json(data)
    } catch (err) {
        console.error(err)
        return res.status(500).json({ error: String(err) })
    }
}
