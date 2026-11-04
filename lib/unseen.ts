// lib/unseen.ts
// "Unseen too long": a pair that no ingest (the page ingest, or the pipeline's refresh of unseen
// pairs) has returned for longer than the verdict's maxUnseenDays. Its stored reserve and prices
// are stale and the pool may be gone, so the verdict takes it out of OoO pricing; once an ingest
// sees it again it is re-judged on fresh data and comes back by itself. Shared by the verdict
// engine and the UI fence mirror, so they can't drift.

// Days since an ingest last returned the pair (Pair.lastChecked), or null when it was never
// stamped (legacy rows): unknown, so the rule doesn't fire on missing data.
export const unseenDays = (lastSeenAt: number, now: number): number | null =>
  lastSeenAt > 0 ? Math.max(0, now - lastSeenAt) / 86_400 : null;

export const unseenTooLong = (lastSeenAt: number, now: number, maxUnseenDays: number): boolean => {
  const days = unseenDays(lastSeenAt, now);
  return days !== null && days > maxUnseenDays;
};
