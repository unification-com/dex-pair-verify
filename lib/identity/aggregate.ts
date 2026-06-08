// Pure aggregation of identity signals (Phase 5, T1). Independent of any
// network/DB so it's trivially unit-testable; the resolver gathers the signals,
// this decides whether they clear the bar.

import { IdentitySignal, TokenIdentityResult } from "./types";

// Non-self-sufficient categories need at least this many INDEPENDENT categories
// to confirm. Independence is by category (see types.ts), so two token lists
// count as one.
export const MIN_INDEPENDENT_CATEGORIES = 2;

// Categories trustworthy enough to confirm a token on their OWN. Curated token
// lists (Uniswap / 1inch / CoinGecko) are human-vetted and exclude spoofs, so a
// listing alone is sufficient. Weaker signals — GoPlus "open-source + holders"
// (a spoof like "ETHERIUM" can have both) — are NOT self-sufficient and need a
// second independent category to corroborate. This asymmetry is what lets us
// promote genuine listed-but-unlinked tokens while still blocking GoPlus-only
// spoofs.
// CoinGecko (a direct reverse contract lookup) is authoritative like a curated
// list — a hit means CG tracks this exact contract, so it confirms on its own.
const SELF_SUFFICIENT_CATEGORIES = new Set<IdentitySignal["category"]>(["tokenlist", "coingecko"]);

export function aggregateIdentity(signals: IdentitySignal[], now: number): TokenIdentityResult {
  // Distinct confirming *categories* — a Set dedupes both repeated categories
  // (two token lists) and accidental duplicate signals from one source.
  const confirmingCategories = new Set(signals.filter((s) => s.confirmed).map((s) => s.category));
  const confirmedCategoryCount = confirmingCategories.size;
  const hasSelfSufficient = Array.from(confirmingCategories).some((c) => SELF_SUFFICIENT_CATEGORIES.has(c));
  return {
    confirmed: hasSelfSufficient || confirmedCategoryCount >= MIN_INDEPENDENT_CATEGORIES,
    confirmedCategoryCount,
    signals,
    checkedAt: now,
  };
}
