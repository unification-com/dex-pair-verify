// Unit tests for the operator allow-list. Entries can be GitHub numeric ids or
// emails, in either ALLOWED_GH_IDS or ALLOWED_USERS (merged, classified by shape).

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isAllowedOperator } from "../../lib/adminAllow";

describe("isAllowedOperator", () => {
  const origIds = process.env.ALLOWED_GH_IDS;
  const origUsers = process.env.ALLOWED_USERS;
  beforeEach(() => {
    delete process.env.ALLOWED_GH_IDS;
    delete process.env.ALLOWED_USERS;
  });
  afterEach(() => {
    process.env.ALLOWED_GH_IDS = origIds;
    process.env.ALLOWED_USERS = origUsers;
  });

  it("matches a GitHub id listed in ALLOWED_GH_IDS", () => {
    process.env.ALLOWED_GH_IDS = "12345, 67890";
    expect(isAllowedOperator({ githubId: "12345" })).toBe(true);
    expect(isAllowedOperator({ githubId: "67890", email: null })).toBe(true);
    expect(isAllowedOperator({ githubId: "00000" })).toBe(false);
  });

  it("ALSO matches a GitHub id mistakenly placed in ALLOWED_USERS (the footgun)", () => {
    // The operator put their numeric id in ALLOWED_USERS — it must still work.
    process.env.ALLOWED_USERS = "12345";
    expect(isAllowedOperator({ githubId: "12345", email: null })).toBe(true);
    expect(isAllowedOperator({ githubId: "99999", email: null })).toBe(false);
  });

  it("matches an email listed in ALLOWED_USERS", () => {
    process.env.ALLOWED_USERS = "ops@example.com, dev@example.com";
    expect(isAllowedOperator({ email: "ops@example.com" })).toBe(true);
    expect(isAllowedOperator({ githubId: "12345", email: "dev@example.com" })).toBe(true);
    expect(isAllowedOperator({ email: "nope@example.com" })).toBe(false);
  });

  it("merges both vars and classifies each entry by shape", () => {
    process.env.ALLOWED_GH_IDS = "12345";
    process.env.ALLOWED_USERS = "ops@example.com, 67890";
    expect(isAllowedOperator({ githubId: "12345" })).toBe(true);
    expect(isAllowedOperator({ githubId: "67890" })).toBe(true);
    expect(isAllowedOperator({ email: "ops@example.com" })).toBe(true);
  });

  it("never cross-matches an id against the email field or vice versa", () => {
    process.env.ALLOWED_GH_IDS = "12345";
    process.env.ALLOWED_USERS = "ops@example.com";
    // email "12345" must not satisfy the id entry; githubId "ops@..." can't happen
    // but a stray match must not occur.
    expect(isAllowedOperator({ email: "12345" })).toBe(false);
    expect(isAllowedOperator({ githubId: "ops@example.com" })).toBe(false);
  });

  it("denies everyone when both vars are empty (locked down)", () => {
    expect(isAllowedOperator({ githubId: "12345", email: "ops@example.com" })).toBe(false);
    expect(isAllowedOperator({})).toBe(false);
  });
});
