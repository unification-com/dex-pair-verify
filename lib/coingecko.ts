// Shared CoinGecko credentials + a single rate-paced fetcher. A free "Demo" API
// key (env GECKO_API_KEY) lifts the rate limit on both the on-chain endpoints
// (GeckoTerminal-equivalent, used by ingest) and the main /api/v3 endpoints
// (used by the canonical-address lookup) via the same `x-cg-demo-api-key`
// header. Without a key, callers fall back to the public/shared rate limits.

import { fetchWithBackoff } from "./httpBackoff";

export const GECKO_API_KEY = process.env.GECKO_API_KEY ?? "";

// Request headers for the CoinGecko Demo key, or undefined when no key is set.
export const cgDemoHeaders = (): Record<string, string> | undefined =>
  GECKO_API_KEY ? { "x-cg-demo-api-key": GECKO_API_KEY } : undefined;

// Minimum spacing between consecutive keyed CoinGecko calls. The budget is
// SHARED across every keyed endpoint — ingest's on-chain pages AND canonical's
// /api/v3 lookups both draw from it — so the binding limit is the tighter of the
// two. Empirically the on-chain (/onchain) endpoint 429s well below the /api/v3
// 30/min ceiling, so we pace at 4s (~15/min) to stay under it and never trip a
// 429 at all: a single 429 costs a 65s back-off (RATE_LIMIT_BACKOFF_MS), which
// dwarfs the extra ~1.5s/call, and both passes run unattended so the slower pace
// is a non-cost. Without a key the public limit is lower still, so pace harder.
export const CG_KEYED_CALL_SPACING_MS = GECKO_API_KEY ? 4000 : 8000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Min-interval gate: the earliest wall-clock time the next CoinGecko call may
// fire. Updated to now + spacing as each call starts, so work done between
// calls (DB writes, verdict runs) counts towards the interval and we only sleep
// the remainder. Assumes sequential callers — true for every batch pass (each
// awaits one item before starting the next), so there's no concurrent race.
let nextCgCallAt = 0;

// The single choke-point for ALL keyed CoinGecko traffic. Spaces calls under the
// Demo key's per-minute window to avoid 429s proactively, then routes through
// fetchWithBackoff so a stray 429 (shared IP, burst) still recovers. The
// `x-cg-demo-api-key` header is attached automatically.
export async function cgKeyedFetch(url: string, label: string): Promise<Response | null> {
  const wait = nextCgCallAt - Date.now();
  if (wait > 0) {
    await sleep(wait);
  }
  nextCgCallAt = Date.now() + CG_KEYED_CALL_SPACING_MS;
  return fetchWithBackoff(url, { headers: cgDemoHeaders() }, label);
}
