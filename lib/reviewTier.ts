// Review-queue triage (T9). Splits a NeedsReview pair into "spam" (clear-bad →
// bulk-rejectable) or "review" (genuine-but-uncertain → manual look). Deliberately
// CONSERVATIVE: a pair only escalates to "spam" on a clear negative signal, so a
// genuine small/new pool is never mislabelled — everything else defaults to
// "review", which is the manual queue.
//
// Honest limitation: obscure meme tokens (ETHERIUM, FLOKIUS…) look real to GoPlus
// (open-source, real holders), so they CAN'T be auto-separated from genuine small
// pools and correctly land in "review". The triage reliably clears only the
// clear-cut spam (impostor / scam-flagged / fake-major-token).

import { VERDICT_REASON, VerdictReasonCode } from "./verdict";

export type ReviewTier = "spam" | "review";

// The token fields the tier needs — assignable from a Prisma Token row.
export type TierToken = {
  id: string;
  chain: string;
  symbol: string;
  coingeckoCoinId: string;
  isScamFlagged: boolean;
};

const hasCgId = (cgId: string): boolean => cgId.trim().length > 0;

// Symbols reserved by convention for blue-chip tokens (stablecoins + wrapped
// natives + BTC/ETH/BNB). A NO-cgId token using one of these is almost certainly
// a fake of the real token (the genuine ones always carry a CoinGecko id). We
// deliberately exclude short/generic tickers (AI, ROBO, SPCX, …) that many
// unrelated tokens legitimately reuse — flagging those mislabels genuine pools.
const MAJOR_TOKEN_SYMBOLS = new Set([
  "USDC", "USDT", "DAI", "BUSD", "TUSD", "FRAX", "USDD", "USDP", "GUSD", "USDC.E",
  "WETH", "ETH", "WBTC", "BTC", "WBNB", "BNB", "WMATIC", "WPOL", "WXDAI", "WAVAX",
]);

// A no-cgId token impersonating a major token by symbol (e.g. a fake "USDC").
const fakesMajorToken = (t: TierToken): boolean =>
  !hasCgId(t.coingeckoCoinId) && MAJOR_TOKEN_SYMBOLS.has(t.symbol.trim().toUpperCase());

// Triage a NeedsReview pair. `reasonCode` is the verdict's structured outcome
// tag (VERDICT_REASON) — switched on directly, never substring-matched.
export function computeReviewTier(reasonCode: VerdictReasonCode, token0: TierToken, token1: TierToken): ReviewTier {
  // Impostor: a token address ≠ its CoinGecko-canonical contract (T3).
  if (reasonCode === VERDICT_REASON.canonicalImpostor) {
    return "spam";
  }
  // GoPlus scam flag (honeypot / extreme tax / hidden owner…) on either token.
  if (token0.isScamFlagged || token1.isScamFlagged) {
    return "spam";
  }
  // A no-cgId token faking a major token by symbol.
  if (fakesMajorToken(token0) || fakesMajorToken(token1)) {
    return "spam";
  }
  return "review";
}
