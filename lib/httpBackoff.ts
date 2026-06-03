// Shared rate-limit-resilient fetch for the external data APIs (GeckoTerminal,
// CoinGecko, GoPlus). Their free tiers all enforce a rolling per-minute window,
// so on a 429 we wait the full window out (a shorter wait just 429s again) and
// retry once. Returns the Response, or null on a hard failure / second 429.
// Failures are logged so a rate limit shows in the `yarn dev` console instead
// of silently yielding nothing.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const RATE_LIMIT_BACKOFF_MS = 65_000;

export async function fetchWithBackoff(
  url: string,
  init: RequestInit | undefined,
  label: string,
): Promise<Response | null> {
  let res = await fetch(url, init);
  if (res.status === 429) {
    console.warn(`[${label}] rate limited (429) — waiting 65s for the window to clear`);
    await sleep(RATE_LIMIT_BACKOFF_MS);
    res = await fetch(url, init);
  }
  if (!res.ok) {
    // 404 is an expected "not found" for some lookups (e.g. a coin not on a
    // chain) — don't shout about it.
    if (res.status !== 404) {
      console.warn(`[${label}] HTTP ${res.status}`);
    }
    return null;
  }
  return res;
}
