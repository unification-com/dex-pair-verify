// Shared token-status promotion: a verified pair implies its tokens are legit,
// so promote them to AutoVerified. Forward-only (never demote — a token may
// live in other good pairs) and R6-safe (operator-set Manual* token statuses
// are left alone). Used by the auto verdict (runVerdictForPair), the manual
// pair-status form, and the bulk approve action so all three behave the same.

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
    },
    data: { status: TokenPairStatus.AutoVerified, verificationMethod: VerificationMethod.Auto },
  });
}
