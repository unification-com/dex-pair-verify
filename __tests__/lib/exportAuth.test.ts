// Unit tests for the export API auth + rate-limit helpers.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isAllowedToken, parseBearer, tokenPrefix } from "../../lib/exportAuth";
import { __resetRateLimit, rateLimit } from "../../lib/rateLimit";

describe("parseBearer", () => {
  it("extracts the token from a Bearer header (case-insensitive)", () => {
    expect(parseBearer("Bearer abc123")).toBe("abc123");
    expect(parseBearer("bearer abc123")).toBe("abc123");
  });

  it("returns null for missing / malformed headers", () => {
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer("")).toBeNull();
    expect(parseBearer("Basic abc")).toBeNull();
    expect(parseBearer("Bearer   ")).toBeNull();
  });
});

describe("isAllowedToken", () => {
  const original = process.env.EXPORT_API_TOKEN;
  beforeEach(() => {
    process.env.EXPORT_API_TOKEN = " tok-one , tok-two ";
  });
  afterEach(() => {
    process.env.EXPORT_API_TOKEN = original;
  });

  it("accepts a token in the comma-separated allow-list (trimmed)", () => {
    expect(isAllowedToken("tok-one")).toBe(true);
    expect(isAllowedToken("tok-two")).toBe(true);
  });

  it("rejects unknown or null tokens", () => {
    expect(isAllowedToken("nope")).toBe(false);
    expect(isAllowedToken(null)).toBe(false);
  });

  it("rejects everything when no tokens are configured", () => {
    process.env.EXPORT_API_TOKEN = "";
    expect(isAllowedToken("tok-one")).toBe(false);
  });
});

describe("tokenPrefix", () => {
  it("shows only the first chars and never the whole secret", () => {
    expect(tokenPrefix("supersecrettoken")).toBe("supers…");
    expect(tokenPrefix(null)).toBe("none");
  });
});

describe("rateLimit", () => {
  beforeEach(() => __resetRateLimit());

  it("allows up to the limit then blocks within the window", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i += 1) {
      expect(rateLimit("k", 3, 1000, now)).toBe(true);
    }
    expect(rateLimit("k", 3, 1000, now)).toBe(false);
  });

  it("resets once the window has elapsed", () => {
    expect(rateLimit("k", 1, 1000, 1_000_000)).toBe(true);
    expect(rateLimit("k", 1, 1000, 1_000_500)).toBe(false); // same window
    expect(rateLimit("k", 1, 1000, 1_001_001)).toBe(true); // new window
  });

  it("tracks keys independently", () => {
    expect(rateLimit("a", 1, 1000, 1_000_000)).toBe(true);
    expect(rateLimit("b", 1, 1000, 1_000_000)).toBe(true);
    expect(rateLimit("a", 1, 1000, 1_000_000)).toBe(false);
  });
});
