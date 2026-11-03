// lib/sourceHealthState.ts
// A source's subgraph health as a state, from the columns lib/sourceHealth.ts
// maintains. Free of Prisma so the /sources page can use it in the browser.

// Consecutive failed checks that pause a source. One failure can be a passing
// indexer blip; a second in a row (hours later) is an outage.
export const UNHEALTHY_AFTER = 2;

export type SourceHealthState = "unchecked" | "healthy" | "failing" | "paused";

export function sourceHealthState(s: { healthCheckedAt: number; healthFailures: number }): SourceHealthState {
  if (s.healthFailures >= UNHEALTHY_AFTER) return "paused";
  if (s.healthFailures > 0) return "failing";
  return s.healthCheckedAt > 0 ? "healthy" : "unchecked";
}
