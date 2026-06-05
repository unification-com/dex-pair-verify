import {requireAdminApi} from "../../../lib/apiAuth";
import {ingestPoolPage} from "../../../lib/ingest";
import {getSourceByIndex, sourceCount} from "../../../lib/sourceConfig";

import type { NextApiRequest, NextApiResponse } from 'next'

// GeckoTerminal ingest, one (source, page) per call. The client loops, passing
// back nextSourceIndex/nextPage until `done`. Non-GeckoTerminal sources (e.g.
// qomswap) are skipped. Verdicts are assigned inline by ingestPoolPage.
export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (!(await requireAdminApi(req, res))) return;

    const idx = Math.max(0, Number(req.body?.sourceIndex) || 0)
    const page = Math.max(1, Number(req.body?.page) || 1)

    const source = getSourceByIndex(idx)
    if (!source) {
        return res.status(200).json({ success: true, data: { done: true } })
    }

    // Skip sources GeckoTerminal doesn't index (advance the cursor).
    if (!source.onCoinGeckoTerminal) {
        const nextSourceIndex = idx + 1
        return res.status(200).json({
            success: true,
            data: {
                chain: source.chain, dex: source.dex, page, skipped: true,
                pairs: 0, tallies: {}, hadData: false,
                nextSourceIndex, nextPage: 1, done: nextSourceIndex >= sourceCount,
            },
        })
    }

    try {
        const result = await ingestPoolPage(source.chain, source.dex, page, {
            gtNetwork: source.gtNetwork,
            gtDex: source.gtDex,
        })

        console.log(`[ingest] ${source.chain}/${source.dex} p${page}: ${result.poolCount} pools, ${result.pairs} stored`, result.tallies)

        const lastPage = source.last_page ?? 1
        let nextSourceIndex = idx
        let nextPage = page + 1
        // Advance to the next source when this page was empty or we hit last_page.
        if (!result.hadData || page >= lastPage) {
            nextSourceIndex = idx + 1
            nextPage = 1
        }

        return res.status(200).json({
            success: true,
            data: {
                chain: source.chain, dex: source.dex, page, skipped: false,
                pairs: result.pairs, tallies: result.tallies, hadData: result.hadData,
                nextSourceIndex, nextPage, done: nextSourceIndex >= sourceCount,
            },
        })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, err: String(err) })
    }
}
