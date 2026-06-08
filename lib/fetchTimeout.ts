// lib/fetchTimeout.ts
// Tiny timeout-bounded fetch shared by the decision-support enrichers (honeypot,
// source-verified, …). Returns null on any failure/timeout so callers degrade to
// a blank signal rather than throwing.
export async function fetchWithTimeout(url: string, init?: RequestInit, ms = 6000): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
