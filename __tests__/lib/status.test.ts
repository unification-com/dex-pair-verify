// Tests for lib/status.ts — the "what counts as verified" helper.

import { describe, expect, it } from "vitest";

import { createdStamps, isVerifiedStatus, statusData, VERIFIED_STATUSES } from "../../lib/status";
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

describe("statusData", () => {
  it("stamps statusChangedAt when the status changes", () => {
    expect(statusData(TokenPairStatus.Unverified, TokenPairStatus.AutoVerified, 100)).toEqual({
      status: TokenPairStatus.AutoVerified,
      statusChangedAt: 100,
    });
  });

  it("leaves statusChangedAt alone when the same status is re-written", () => {
    expect(statusData(TokenPairStatus.NeedsReview, TokenPairStatus.NeedsReview, 100)).toEqual({
      status: TokenPairStatus.NeedsReview,
    });
  });
});

describe("createdStamps", () => {
  it("dates a new row's status from its creation", () => {
    expect(createdStamps(100)).toEqual({ createdAt: 100, statusChangedAt: 100 });
  });
});
