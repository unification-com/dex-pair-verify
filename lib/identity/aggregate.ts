// Pure aggregation of identity signals (Phase 5, T1). Independent of any
// network/DB so it's trivially unit-testable; the resolver gathers the signals,
// this decides whether they clear the bar.

import { IdentitySignal, TokenIdentityResult } from "./types";

// A token needs at least this many INDEPENDENT categories to positively confirm
// before it can take the auto-verify path without a CoinGecko coin id. Two keeps
// the bar meaningful (a single token list is weak — they overlap) without being
// unreachable. Independence is by category (see types.ts), so two token lists
// count as one.
export const MIN_INDEPENDENT_CATEGORIES = 2;

export function aggregateIdentity(signals: IdentitySignal[], now: number): TokenIdentityResult {
  // Distinct confirming *categories* — a Set dedupes both repeated categories
  // (two token lists) and accidental duplicate signals from one source.
  const confirmingCategories = new Set(signals.filter((s) => s.confirmed).map((s) => s.category));
  const confirmedCategoryCount = confirmingCategories.size;
  return {
    confirmed: confirmedCategoryCount >= MIN_INDEPENDENT_CATEGORIES,
    confirmedCategoryCount,
    signals,
    checkedAt: now,
  };
}
