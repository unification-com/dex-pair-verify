// Review-queue enrichment selection (B5). Picks the tokens in NeedsReview pairs
// that haven't had a full on-demand scan this job, so the decision-support
// enrichers (GoPlus + Honeypot.is + Etherscan source-verified + web presence) can
// be pre-run in a batch — the review queue then arrives PRE-SCANNED instead of the
// operator waiting on the per-token "Run security scan" button (which stays the
// fallback). The per-token work itself is the existing runSecurityScanForToken
// (DRY); this module only scopes the batch. Resumable + bounded via
// securityCheckedAt, mirroring the scam/identity batch contracts.

import { Prisma } from "@prisma/client";

import { EVM_SUPPORTED_CHAINS } from "./chains";
import prisma from "./prisma";
import { TokenPairStatus } from "../types/types";

// Tokens worth enriching for review: on a chain the enrichers cover, belonging to
// ≥1 NeedsReview pair, and not yet scanned this job (securityCheckedAt <
// jobStartedAt — runSecurityScanForToken stamps it, so the batch drains to empty).
const reviewEnrichWhere = (jobStartedAt: number): Prisma.TokenWhereInput => ({
  chain: { in: EVM_SUPPORTED_CHAINS },
  securityCheckedAt: { lt: jobStartedAt },
  OR: [
    { pairsToken0: { some: { status: TokenPairStatus.NeedsReview } } },
    { pairsToken1: { some: { status: TokenPairStatus.NeedsReview } } },
  ],
});

export async function tokensToReviewEnrich(jobStartedAt: number, batch: number): Promise<string[]> {
  const rows = await prisma.token.findMany({
    where: reviewEnrichWhere(jobStartedAt),
    select: { id: true },
    take: batch,
  });
  return rows.map((r) => r.id);
}

export async function countTokensToReviewEnrich(jobStartedAt: number): Promise<number> {
  return prisma.token.count({ where: reviewEnrichWhere(jobStartedAt) });
}
