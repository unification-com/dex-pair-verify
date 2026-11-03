// Tests for lib/sourceHealthState.ts: a source's health state from its health columns.

import { describe, expect, it } from "vitest";

import { sourceHealthState, UNHEALTHY_AFTER } from "../../lib/sourceHealthState";

describe("sourceHealthState", () => {
  it("is unchecked before the first check", () => {
    expect(sourceHealthState({ healthCheckedAt: 0, healthFailures: 0 })).toBe("unchecked");
  });

  it("is healthy after a passing check", () => {
    expect(sourceHealthState({ healthCheckedAt: 100, healthFailures: 0 })).toBe("healthy");
  });

  it("is failing after one failed check, paused from UNHEALTHY_AFTER in a row", () => {
    expect(UNHEALTHY_AFTER).toBe(2);
    expect(sourceHealthState({ healthCheckedAt: 100, healthFailures: 1 })).toBe("failing");
    expect(sourceHealthState({ healthCheckedAt: 100, healthFailures: 2 })).toBe("paused");
    expect(sourceHealthState({ healthCheckedAt: 100, healthFailures: 5 })).toBe("paused");
  });
});
