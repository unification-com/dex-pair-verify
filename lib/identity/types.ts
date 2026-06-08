// Multi-source token identity (Phase 5, T1). The verdict engine's auto-verify
// path hinges on a token being *known* — historically only via a CoinGecko coin
// id, which leaves every legitimate-but-unlisted token in the manual queue. These
// types model independent identity sources (token lists, on-chain checks,
// security APIs) whose agreement lets a non-CG-listed token still be trusted.
//
// Pure data shapes only — the source adapters + the DB-backed resolver live
// alongside; the verdict engine consumes just the derived `identityConfirmed`
// boolean (kept pure + unit-testable, the same way it consumes tokenScamFlagged).

// Independence is counted by CATEGORY, not by individual source: two token lists
// (which often derive from each other) are NOT two independent confirmations.
export type IdentityCategory = "tokenlist" | "onchain" | "security-api" | "coingecko" | "coinmarketcap" | "first-party";

// One source's opinion on a token. `confirmed` = this source positively
// recognises a real, legitimate ERC-20 at this (chain, address).
export type IdentitySignal = {
  source: string; // e.g. "tokenlist:uniswap", "goplus", "onchain:erc20-shape"
  category: IdentityCategory;
  confirmed: boolean;
  detail?: string; // human-readable note (which list, holder count, …) for audit
};

export type TokenIdentityResult = {
  // Derived: ≥ MIN_INDEPENDENT_CATEGORIES distinct categories confirmed it.
  confirmed: boolean;
  confirmedCategoryCount: number;
  signals: IdentitySignal[];
  checkedAt: number; // unix seconds
};
