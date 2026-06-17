// lib/clientIp.ts
// Best-effort client IP for per-IP rate-limiting: the first x-forwarded-for hop (set by the proxy), else
// the socket address. Spoofable without a trusted proxy — an edge limiter is the real defence (security
// audit L7); this is enough to throttle casual abuse. Shared by the public + auth endpoints (DRY).

import type { NextApiRequest } from "next";

export const clientIp = (req: NextApiRequest): string => {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0].trim();
  }
  if (Array.isArray(fwd) && fwd.length > 0) {
    return fwd[0];
  }
  return req.socket?.remoteAddress ?? "anon";
};
