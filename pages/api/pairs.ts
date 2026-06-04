import { buildPublicPairsCatalogue, publicCatalogueLastModified } from "../../lib/export";
import { rateLimit } from "../../lib/rateLimit";

import type { NextApiRequest, NextApiResponse } from "next";

// PUBLIC, UNGATED supported-pairs catalogue (T10) — the "menu" of queryable pairs
// for OoO users (e.g. WETH.USDC.AD). Distinct from the gated provider feeds
// (/api/export/*, bearer-token): it carries NO trust internals, only what can be
// queried, so it's safe to expose without a token. Cacheable + If-Modified-Since
// aware; a light per-IP rate limit guards against abuse (the data is non-sensitive,
// so the cache does most of the work).
const RATE_LIMIT = 120; // requests
const RATE_WINDOW_MS = 60_000; // per minute, per IP
const MAX_AGE_S = 300; // 5-minute public cache

const clientIp = (req: NextApiRequest): string => {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0].trim();
  }
  return req.socket?.remoteAddress ?? "anon";
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  if (!rateLimit(`pairs:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS, Date.now())) {
    return res.status(429).json({ error: "rate limit exceeded" });
  }

  try {
    const lastModified = await publicCatalogueLastModified();
    res.setHeader("Cache-Control", `public, max-age=${MAX_AGE_S}`);
    res.setHeader("Last-Modified", new Date(lastModified * 1000).toUTCString());

    // Standard If-Modified-Since 304 short-circuit (second precision).
    const ims = req.headers["if-modified-since"];
    if (typeof ims === "string") {
      const since = Math.floor(Date.parse(ims) / 1000);
      if (Number.isFinite(since) && lastModified <= since) {
        return res.status(304).end();
      }
    }

    const catalogue = await buildPublicPairsCatalogue();
    return res.status(200).json(catalogue);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err) });
  }
}
