// Shared token-status promotion: a verified pair implies its tokens are legit,
// so promote them to AutoVerified. Forward-only (never demote — a token may
// live in other good pairs) and R6-safe (operator-set Manual* token statuses
// are left alone). Used by the auto verdict (runVerdictForPair), the manual
// pair-status form, and the bulk approve action so all three behave the same.
//
// The forward-only rule has one exception: a SCAM flag is token-intrinsic (a
// honeypot is a honeypot in every pair), so a scam-flagged token must never be
// promoted, and one that was auto-verified BEFORE a later scam pass flagged it
// is demoted out of AutoVerified by demoteScamFlaggedTokens.

import prisma from "./prisma";
import { TokenPairStatus, VerificationMethod } from "../types/types";

export async function promoteTokensToVerified(tokenIds: string[]): Promise<void> {
  if (tokenIds.length === 0) {
    return;
  }
  await prisma.token.updateMany({
    where: {
      id: { in: tokenIds },
      status: { notIn: [TokenPairStatus.ManualVerified, TokenPairStatus.ManualRejected] },
      isScamFlagged: false, // never promote a scam-flagged token (a honeypot is token-intrinsic)
    },
    data: { status: TokenPairStatus.AutoVerified, verificationMethod: VerificationMethod.Auto },
  });
}

// Demote scam-flagged tokens that are still sitting in AutoVerified down to NeedsReview — mirroring how
// a scam-flagged PAIR is routed (conservative + reversible, not auto-rejected, since honeypot detection
// can false-positive). Needed because the promotion above is forward-only: a token auto-verified before
// a later scam pass flagged it keeps its AutoVerified status while its pairs are routed to review.
// R6-safe (only AutoVerified is touched; operator Manual* statuses are left alone). Scope to tokenIds
// when given (the live scam pass demotes the token it just flagged), else sweep all (revalidate's
// catch-up). Idempotent. Returns the number demoted.
export async function demoteScamFlaggedTokens(tokenIds?: string[]): Promise<number> {
  const res = await prisma.token.updateMany({
    where: {
      isScamFlagged: true,
      status: TokenPairStatus.AutoVerified,
      ...(tokenIds ? { id: { in: tokenIds } } : {}),
    },
    data: { status: TokenPairStatus.NeedsReview, verificationMethod: VerificationMethod.Auto },
  });
  return res.count;
}
