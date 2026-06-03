// Tests for lib/status.ts — the "what counts as verified" helper.

import { describe, expect, it } from "vitest";

import { isVerifiedStatus, VERIFIED_STATUSES } from "../../lib/status";
import { TokenPairStatus } from "../../types/types";

describe("isVerifiedStatus", () => {
  it("treats ManualVerified and AutoVerified as verified", () => {
    expect(isVerifiedStatus(TokenPairStatus.ManualVerified)).toBe(true);
    expect(isVerifiedStatus(TokenPairStatus.AutoVerified)).toBe(true);
  });

  it("treats every other status as not verified", () => {
    for (const s of [
      TokenPairStatus.Unverified,
      TokenPairStatus.NeedsReview,
      TokenPairStatus.AutoRejected,
      TokenPairStatus.ManualRejected,
      TokenPairStatus.Duplicate,
      TokenPairStatus.NotCurrentlyUsable,
    ]) {
      expect(isVerifiedStatus(s)).toBe(false);
    }
  });

  it("VERIFIED_STATUSES is exactly the two verified states", () => {
    expect([...VERIFIED_STATUSES].sort()).toEqual(
      [TokenPairStatus.AutoVerified, TokenPairStatus.ManualVerified].sort(),
    );
  });
});
