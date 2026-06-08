// Shared rate-limit-resilient fetch for the external data APIs (GeckoTerminal,
// CoinGecko, GoPlus, CoinMarketCap). Their free tiers all enforce a rolling
// per-minute window, so on a 429 we wait the full window out (a shorter wait just
// 429s again) and retry once. Failures are logged so a rate limit shows in the
// `yarn dev` console instead of silently yielding nothing.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const RATE_LIMIT_BACKOFF_MS = 65_000;

// fetch() that never throws — a network error (DNS failure, connection reset,
// flaky gateway) becomes null rather than a thrown exception, so a single bad
// endpoint can't crash a whole batch pass.
async function tryFetch(url: string, init: RequestInit | undefined, label: string): Promise<Response | null> {
  try {
    return await fetch(url, init);
  } catch (e) {
    console.warn(`[${label}] network error: ${String(e)}`);
    return null;
  }
}

// Raw fetch with a single 429 back-off retry. Returns the Response for ANY HTTP
// status (the caller classifies 2xx/4xx/5xx itself) — only a network error
// yields null. Use this directly when an API's "not found" is a non-404 status
// that should NOT be logged as an error (e.g. CoinMarketCap returns a 400 for an
// untracked address); fetchWithBackoff layers the !ok→null + logging policy on top.
export async function fetchRawWithBackoff(
  url: string,
  init: RequestInit | undefined,
  label: string,
): Promise<Response | null> {
  let res = await tryFetch(url, init, label);
  if (res && res.status === 429) {
    console.warn(`[${label}] rate limited (429) — waiting 65s for the window to clear`);
    await sleep(RATE_LIMIT_BACKOFF_MS);
    res = await tryFetch(url, init, label);
  }
  return res;
}

// Returns the Response only on a 2xx; any non-2xx (or network error) degrades to
// null. A 404 is an expected "not found" for some lookups (e.g. a coin not on a
// chain) so it's logged quietly; other error statuses are warned.
export async function fetchWithBackoff(
  url: string,
  init: RequestInit | undefined,
  label: string,
): Promise<Response | null> {
  const res = await fetchRawWithBackoff(url, init, label);
  if (!res) {
    return null;
  }
  if (!res.ok) {
    if (res.status !== 404) {
      console.warn(`[${label}] HTTP ${res.status}`);
    }
    return null;
  }
  return res;
}

// A min-interval rate gate (closure schedule) around a fetch fn. Each instance
// owns its own schedule, so independent services (CoinGecko, GoPlus, CMC) pace
// against their own per-minute budgets without interfering. Spacing calls
// PROACTIVELY keeps us under the limit so we rarely trip a 429 at all — far
// cheaper than the reactive 65s back-off above. Work done between calls (DB
// writes, verdict runs) counts towards the interval, so it only sleeps the
// remainder. Assumes sequential callers — true for every batch pass (each awaits
// one item before the next), so there's no concurrent race on `nextAt`. The
// wrapped fn takes (url, init, label); the gate exposes (url, label, init?).
function paced(
  spacingMs: number,
  fn: (url: string, init: RequestInit | undefined, label: string) => Promise<Response | null>,
): (url: string, label: string, init?: RequestInit) => Promise<Response | null> {
  let nextAt = 0;
  return async (url, label, init) => {
    const wait = nextAt - Date.now();
    if (wait > 0) {
      await sleep(wait);
    }
    nextAt = Date.now() + spacingMs;
    return fn(url, init, label);
  };
}

// Paced fetcher with the 2xx-only mapping (the common case).
export const makePacedFetch = (
  spacingMs: number,
): ((url: string, label: string, init?: RequestInit) => Promise<Response | null>) => paced(spacingMs, fetchWithBackoff);

// Paced fetcher that returns the raw Response (any status) for callers that must
// classify non-2xx statuses themselves (e.g. CMC's 400 "untracked address").
export const makePacedRawFetch = (
  spacingMs: number,
): ((url: string, label: string, init?: RequestInit) => Promise<Response | null>) => paced(spacingMs, fetchRawWithBackoff);
