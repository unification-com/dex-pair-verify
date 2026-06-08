import { Prisma } from "@prisma/client";

import { fetchPoolPrices } from "../../../../lib/priceFetch";
import prisma from "../../../../lib/prisma";
import { rateLimit } from "../../../../lib/rateLimit";
import { VERIFIED_STATUSES } from "../../../../lib/status";

import type { NextApiRequest, NextApiResponse } from "next";

// PUBLIC, CACHED OoO price fetch for the public simulator. Always "latest only"
// (no historical `mins`), keyed by (chain, dex, sorted pool addresses) and served
// from a 7-day cache so anonymous traffic never hits the operator's paid subgraph.
// On a fetch failure with a warm cache, the stale copy is served rather than
// erroring. The operator price-test uses the live /api/admin/getprices instead.
const CACHE_TTL_S = 7 * 24 * 3600; // 7 days
const RATE_LIMIT = 60; // requests
const RATE_WINDOW_MS = 60_000; // per minute, per IP
const MAX_ADDRESSES = 25; // bound the subgraph query size

const clientIp = (req: NextApiRequest): string => {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress ?? "anon";
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, error: "method not allowed" });
  }
  if (!rateLimit(`prices:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS, Date.now())) {
    return res.status(429).json({ success: false, error: "rate limit exceeded" });
  }

  const chain = String(req.query?.chain || "");
  const dex = String(req.query?.dex || "");
  const addresses = String(req.query?.addresses || "").split(",").map((a) => a.trim()).filter(Boolean).slice(0, MAX_ADDRESSES);
  if (!chain || !dex || addresses.length === 0) {
    return res.status(400).json({ success: false, prices: [], chain, dex, error: "chain, dex and addresses required" });
  }

  // Cost-amplification guard: only price pools that belong to a VERIFIED pair on
  // this (chain, dex). Without this an anonymous caller could pass arbitrary pool
  // addresses and force a cache-missing upstream call against the operator's paid
  // subgraph key on every request. Stored addresses may be checksummed, so match
  // case-insensitively.
  const verifiedPools = await prisma.pair.findMany({
    where: { chain, dex, status: { in: [...VERIFIED_STATUSES] } },
    select: { contractAddress: true },
  });
  const allowed = new Set(verifiedPools.map((p) => p.contractAddress.toLowerCase()));
  const safeAddresses = addresses.filter((a) => allowed.has(a.toLowerCase()));
  if (safeAddresses.length === 0) {
    return res.status(200).json({ success: true, chain, dex, prices: [], cached: false });
  }

  const cacheKey = `${chain}|${dex}|${safeAddresses.map((a) => a.toLowerCase()).sort().join(",")}`;
  const now = Math.floor(Date.now() / 1000);

  const cached = await prisma.priceCache.findUnique({ where: { cacheKey } });
  if (cached && now - cached.fetchedAt < CACHE_TTL_S) {
    return res.status(200).json({ success: true, chain, dex, prices: cached.data, cached: true, fetchedAt: cached.fetchedAt });
  }

  // Public is always latest-only (minutes = 0).
  const r = await fetchPoolPrices(chain, dex, safeAddresses, 0);
  if (!r.success) {
    // Serve a warm-but-stale cache rather than failing the page.
    if (cached) {
      return res.status(200).json({ success: true, chain, dex, prices: cached.data, cached: true, fetchedAt: cached.fetchedAt, stale: true });
    }
    return res.status(502).json({ success: false, chain, dex, prices: [], error: r.error });
  }

  try {
    await prisma.priceCache.upsert({
      where: { cacheKey },
      create: { cacheKey, data: r.prices as unknown as Prisma.InputJsonValue, fetchedAt: now },
      update: { data: r.prices as unknown as Prisma.InputJsonValue, fetchedAt: now },
    });
  } catch {
    // cache write is best-effort — never block the response on it
  }
  return res.status(200).json({ success: true, chain, dex, prices: r.prices, cached: false, fetchedAt: now });
}
