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

// Minimum spacing between consecutive keyed CoinGecko calls. The Demo key allows
// 100 calls/min, SHARED across every keyed endpoint (ingest's /onchain pages +
// canonical's /api/v3 lookups draw from one budget). We pace at 1s (~60/min) —
// comfortably under 100/min with headroom for burst/jitter — so we proactively
// avoid the 65s 429 back-off (RATE_LIMIT_BACKOFF_MS) without throttling need-
// lessly. CRITICAL: this only holds if the key is actually applied — the header
// must be present at request time (see lib/env.ts; the key is read eagerly here
// at module load, so .env MUST be loaded first). Without a key, requests fall
// back to the keyless ~30/min shared-IP public limit, so we pace far harder.
export const CG_KEYED_CALL_SPACING_MS = GECKO_API_KEY ? 1000 : 8000;

// The single choke-point for ALL keyed CoinGecko traffic (ingest + canonical) —
// one paced fetcher so the two passes share one schedule and can't collectively
// overrun the Demo key's per-minute window. The `x-cg-demo-api-key` header is
// attached automatically.
const pacedCgFetch = makePacedFetch(CG_KEYED_CALL_SPACING_MS);
export const cgKeyedFetch = (url: string, label: string): Promise<Response | null> =>
  pacedCgFetch(url, label, { headers: cgDemoHeaders() });
