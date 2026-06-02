// Minimal in-memory fixed-window rate limiter for the export API. Sufficient
// for a single long-running instance (the export API is low-frequency — go-ooo
// polls periodically). On serverless it resets per cold start, which only ever
// loosens the limit, never tightens it — safe. `now` is injected so callers
// pass Date.now() and tests stay deterministic.

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

// Returns true if the call is allowed, false if the key is over its limit for
// the current window.
export const rateLimit = (key: string, limit: number, windowMs: number, now: number): boolean => {
  const w = windows.get(key);
  if (!w || now >= w.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (w.count >= limit) {
    return false;
  }
  w.count += 1;
  return true;
};

// Test-only: clear all windows.
export const __resetRateLimit = (): void => {
  windows.clear();
};
