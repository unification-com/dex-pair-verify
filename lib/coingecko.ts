// Shared CoinGecko credentials. A free "Demo" API key (env GECKO_API_KEY) lifts
// the rate limit on both the on-chain endpoints (GeckoTerminal-equivalent, used
// by ingest) and the main /api/v3 endpoints (used by the canonical-address
// lookup) via the same `x-cg-demo-api-key` header. Without a key, callers fall
// back to the public/shared rate limits.

export const GECKO_API_KEY = process.env.GECKO_API_KEY ?? "";

// Request headers for the CoinGecko Demo key, or undefined when no key is set.
export const cgDemoHeaders = (): Record<string, string> | undefined =>
  GECKO_API_KEY ? { "x-cg-demo-api-key": GECKO_API_KEY } : undefined;
