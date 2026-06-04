// Shared CoinGecko credentials + a single rate-paced fetcher. A free "Demo" API
// key (env GECKO_API_KEY) lifts the rate limit on both the on-chain endpoints
// (GeckoTerminal-equivalent, used by ingest) and the main /api/v3 endpoints
// (used by the canonical-address lookup) via the same `x-cg-demo-api-key`
// header. Without a key, callers fall back to the public/shared rate limits.

import { makePacedFetch } from "./httpBackoff";

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

// The single choke-point for ALL keyed CoinGecko traffic (ingest + canonical) —
// one paced fetcher so the two passes share one schedule and can't collectively
// overrun the Demo key's per-minute window. The `x-cg-demo-api-key` header is
// attached automatically.
const pacedCgFetch = makePacedFetch(CG_KEYED_CALL_SPACING_MS);
export const cgKeyedFetch = (url: string, label: string): Promise<Response | null> =>
  pacedCgFetch(url, label, { headers: cgDemoHeaders() });
