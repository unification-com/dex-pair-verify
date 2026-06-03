// Review-queue triage (T9). Splits a NeedsReview pair into "spam" (clear-bad →
// bulk-rejectable) or "review" (genuine-but-uncertain → manual look). Deliberately
// CONSERVATIVE: a pair only escalates to "spam" on a clear negative signal, so a
// genuine small/new pool is never mislabelled — everything else defaults to
// "review", which is the manual queue.
//
// Honest limitation: obscure meme tokens (ETHERIUM, FLOKIUS…) look real to GoPlus
// (open-source, real holders), so they CAN'T be auto-separated from genuine small
// pools and correctly land in "review". The triage reliably clears only the
// clear-cut spam (impostor / scam-flagged / exact-symbol spoof of a known token).

import prisma from "./prisma";

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

// A no-cgId token whose symbol exactly matches a DIFFERENT cgId-bearing token on
// the same chain — i.e. a fake "USDC"/"WETH"/… of a token CoinGecko knows. The
// real one has the cgId; this impostor doesn't.
async function spoofsKnownSymbol(t: TierToken): Promise<boolean> {
  if (hasCgId(t.coingeckoCoinId) || !t.symbol) {
    return false;
  }
  const knownTwins = await prisma.token.count({
    where: { chain: t.chain, symbol: t.symbol, coingeckoCoinId: { not: "" }, id: { not: t.id } },
  });
  return knownTwins > 0;
}

// Triage a NeedsReview pair. `reason` is the verdict's verificationComment.
export async function computeReviewTier(
  reason: string,
  token0: TierToken,
  token1: TierToken,
): Promise<ReviewTier> {
  // Impostor: a token address ≠ its CoinGecko-canonical contract (T3).
  if (reason.toLowerCase().includes("impostor")) {
    return "spam";
  }
  // GoPlus scam flag (honeypot / extreme tax / hidden owner…) on either token.
  if (token0.isScamFlagged || token1.isScamFlagged) {
    return "spam";
  }
  // Exact-symbol spoof of a known (cgId-bearing) token.
  if ((await spoofsKnownSymbol(token0)) || (await spoofsKnownSymbol(token1))) {
    return "spam";
  }
  return "review";
}
