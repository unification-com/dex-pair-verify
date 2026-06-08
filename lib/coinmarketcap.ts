// Shared CoinMarketCap credentials + a single rate-paced fetcher. Unlike
// CoinGecko, CMC has NO keyless tier — every call needs the Pro-API key
// (env CMC_PRO_API_KEY; the free "Basic" plan works). The key is read eagerly at
// module load, so .env MUST be loaded first (see lib/env.ts), same as coingecko.ts.

import { makePacedRawFetch } from "./httpBackoff";

export const CMC_PRO_API_KEY = process.env.CMC_PRO_API_KEY ?? "";

// Request headers for the CMC Pro-API key, or undefined when no key is set.
export const cmcHeaders = (): Record<string, string> | undefined =>
  CMC_PRO_API_KEY ? { "X-CMC_PRO_API_KEY": CMC_PRO_API_KEY, Accept: "application/json" } : undefined;

// CMC Basic (free) plan: 30 calls/min, 10k/month. Pace ~2.5s (~24/min) so we stay
// under the per-minute window with headroom and rarely trip the 65s back-off.
export const CMC_CALL_SPACING_MS = 2500;

// The single choke-point for keyed CMC traffic. RAW (returns the Response of any
// status) because CMC signals an untracked address with a 400, NOT a 404 — the
// caller must read that status to treat it as a quiet "not found" rather than
// logged error noise. The X-CMC_PRO_API_KEY header is attached automatically.
const pacedCmcRawFetch = makePacedRawFetch(CMC_CALL_SPACING_MS);
export const cmcKeyedRawFetch = (url: string, label: string): Promise<Response | null> =>
  pacedCmcRawFetch(url, label, { headers: cmcHeaders() });
