// Integration tests for lib/statusWrite.ts and the token-status passes built on it:
// statusChangedAt moves only on a real status transition.

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, seedPair, seedToken, testPrisma } from "./helpers";
import { setStatusWhere } from "../../lib/statusWrite";
import { demoteScamFlaggedTokens, promoteTokensToVerified } from "../../lib/tokenStatus";
import { TokenPairStatus } from "../../types/types";

const THEN = 1_600_000_000;
const NOW = 1_700_000_000;

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const pairRow = (id: string) => testPrisma.pair.findUniqueOrThrow({ where: { id } });
const tokenRow = (id: string) => testPrisma.token.findUniqueOrThrow({ where: { id } });

describe("setStatusWhere", () => {
  it("stamps only the rows whose status changes, writes the extra fields to all, counts all", async () => {
    const t0 = await seedToken();
    const t1 = await seedToken();
    const moving = await seedPair(t0.id, t1.id, { status: TokenPairStatus.NeedsReview, statusChangedAt: THEN });
    const already = await seedPair(t0.id, t1.id, { status: TokenPairStatus.ManualVerified, statusChangedAt: THEN });
    const untouched = await seedPair(t0.id, t1.id, { status: TokenPairStatus.NeedsReview, statusChangedAt: THEN });

    const count = await setStatusWhere("pair", { id: { in: [moving.id, already.id] } }, TokenPairStatus.ManualVerified, { verificationComment: "bulk" }, NOW);

    expect(count).toBe(2);
    expect(await pairRow(moving.id)).toMatchObject({ status: TokenPairStatus.ManualVerified, statusChangedAt: NOW, verificationComment: "bulk" });
    expect(await pairRow(already.id)).toMatchObject({ status: TokenPairStatus.ManualVerified, statusChangedAt: THEN, verificationComment: "bulk" });
    expect(await pairRow(untouched.id)).toMatchObject({ status: TokenPairStatus.NeedsReview, statusChangedAt: THEN });
  });

  it("returns 0 when nothing matches", async () => {
    expect(await setStatusWhere("token", { id: "missing" }, TokenPairStatus.AutoVerified, {}, NOW)).toBe(0);
  });
});

describe("token status passes", () => {
  it("promotion stamps newly verified tokens and leaves already-verified and Manual* ones alone", async () => {
    const fresh = await seedToken({ statusChangedAt: THEN });
    const verified = await seedToken({ status: TokenPairStatus.AutoVerified, statusChangedAt: THEN });
    const manual = await seedToken({ status: TokenPairStatus.ManualRejected, statusChangedAt: THEN });

    await promoteTokensToVerified([fresh.id, verified.id, manual.id], NOW);

    expect(await tokenRow(fresh.id)).toMatchObject({ status: TokenPairStatus.AutoVerified, statusChangedAt: NOW });
    expect(await tokenRow(verified.id)).toMatchObject({ status: TokenPairStatus.AutoVerified, statusChangedAt: THEN });
    expect(await tokenRow(manual.id)).toMatchObject({ status: TokenPairStatus.ManualRejected, statusChangedAt: THEN });
  });

  it("scam demotion stamps the demoted token", async () => {
    const flagged = await seedToken({ status: TokenPairStatus.AutoVerified, isScamFlagged: true, statusChangedAt: THEN });

    expect(await demoteScamFlaggedTokens([flagged.id], NOW)).toBe(1);
    expect(await tokenRow(flagged.id)).toMatchObject({ status: TokenPairStatus.NeedsReview, statusChangedAt: NOW });
  });
});
