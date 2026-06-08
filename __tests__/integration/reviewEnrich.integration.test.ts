// Integration test for the review-queue enrichment selection (B5). Asserts the
// batch picks exactly the EVM tokens in NeedsReview pairs that haven't been
// scanned this job — verified-only / already-scanned / non-EVM are excluded.

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, seedPair, seedToken, testPrisma } from "./helpers";
import { countTokensToReviewEnrich, tokensToReviewEnrich } from "../../lib/reviewEnrich";
import { TokenPairStatus } from "../../types/types";

const NOW = 1_700_000_000;

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("tokensToReviewEnrich", () => {
  it("selects only EVM NeedsReview-pair tokens not yet scanned this job", async () => {
    // A NeedsReview pair → both tokens qualify.
    const t0 = await seedToken();
    const t1 = await seedToken();
    await seedPair(t0.id, t1.id, { status: TokenPairStatus.NeedsReview });

    // A verified-only pair → its tokens don't (nothing to review).
    const v0 = await seedToken();
    const v1 = await seedToken();
    await seedPair(v0.id, v1.id, { status: TokenPairStatus.AutoVerified });

    // Already scanned this job (securityCheckedAt == jobStartedAt, not <) → excluded;
    // its un-scanned partner still qualifies.
    const checked = await seedToken({ securityCheckedAt: NOW });
    const partner = await seedToken();
    await seedPair(checked.id, partner.id, { status: TokenPairStatus.NeedsReview });

    // Non-EVM NeedsReview pair → excluded (the enrichers are EVM-only).
    const q0 = await seedToken({ chain: "qom" });
    const q1 = await seedToken({ chain: "qom" });
    await seedPair(q0.id, q1.id, { chain: "qom", dex: "qomswap_v2", status: TokenPairStatus.NeedsReview });

    const ids = await tokensToReviewEnrich(NOW, 50);
    expect(ids.sort()).toEqual([t0.id, t1.id, partner.id].sort());
    expect(await countTokensToReviewEnrich(NOW)).toBe(3);
  });
});
