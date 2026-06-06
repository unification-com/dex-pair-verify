import {buildExportManifestV3} from "../../../../../lib/export";
import {checkBearerToken, parseBearer, tokenPrefix} from "../../../../../lib/exportAuth";
import {rateLimit} from "../../../../../lib/rateLimit";

import type { NextApiRequest, NextApiResponse } from 'next'

// Bearer-token discovery manifest (4.C, v3): the SupportedSource registry — each
// source's subgraph endpoint list, schema family, factory, rpc + verified pair
// count — so go-ooo consumes it as its source of truth instead of a hard-coded
// list. Lives at /api/ooo/v1/export/manifest alongside the per-(chain,dex) bearer export.
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
        const data = await buildExportManifestV3()
        console.log(JSON.stringify({ export: "manifest", v: data.schemaVersion, token: tokenPrefix(token), sources: data.supportedSources.length, ms: Date.now() - started }))
        return res.status(200).json(data)
    } catch (err) {
        console.error(err)
        return res.status(500).json({ error: String(err) })
    }
}
