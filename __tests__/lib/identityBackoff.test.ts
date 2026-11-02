// Tests for nextIdentityCheckAt: when the identity pass looks at a token again.

import { describe, expect, it } from "vitest";

import { nextIdentityCheckAt } from "../../lib/identityCheck";

const DAY = 86_400;
const NOW = 1_700_000_000;
const BASE = 7 * DAY;
const never = { checkedAt: 0, nextCheckAt: 0, confirmed: false };

describe("nextIdentityCheckAt", () => {
  it("re-checks a first miss after the base window", () => {
    expect(nextIdentityCheckAt(never, false, NOW, BASE)).toBe(NOW + 7 * DAY);
  });

  it("doubles the gap on each further miss, capped at 90 days", () => {
    let prev = never;
    const gaps: number[] = [];
    let now = NOW;
    for (let i = 0; i < 6; i++) {
      const next = nextIdentityCheckAt(prev, false, now, BASE);
      gaps.push((next - now) / DAY);
      prev = { checkedAt: now, nextCheckAt: next, confirmed: false };
      now = next;
    }
    expect(gaps).toEqual([7, 14, 28, 56, 90, 90]);
  });

  it("re-checks a confirmed token in a month", () => {
    expect(nextIdentityCheckAt({ checkedAt: NOW - 56 * DAY, nextCheckAt: NOW, confirmed: false }, true, NOW, BASE)).toBe(NOW + 30 * DAY);
  });

  it("restarts the back-off at the base when a confirmed token stops confirming", () => {
    expect(nextIdentityCheckAt({ checkedAt: NOW - 30 * DAY, nextCheckAt: NOW, confirmed: true }, false, NOW, BASE)).toBe(NOW + 7 * DAY);
  });

  it("re-checks every run when the window is 0", () => {
    expect(nextIdentityCheckAt({ checkedAt: NOW - DAY, nextCheckAt: NOW, confirmed: false }, false, NOW, 0)).toBe(NOW + 2 * DAY);
    expect(nextIdentityCheckAt(never, false, NOW, 0)).toBe(NOW);
  });
});
