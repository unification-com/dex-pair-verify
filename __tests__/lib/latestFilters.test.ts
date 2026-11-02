// Tests for lib/latestFilters.ts: the /latest query-string whitelist.

import { describe, expect, it } from "vitest";

import { DEFAULT_LATEST_LIMIT, parseLatestFilters } from "../../lib/latestFilters";

describe("parseLatestFilters", () => {
  it("defaults to everything, newest added, the default limit", () => {
    expect(parseLatestFilters({})).toEqual({ kind: null, chain: null, dex: null, order: "added", limit: DEFAULT_LATEST_LIMIT });
  });

  it("reads every filter", () => {
    expect(parseLatestFilters({ type: "token", chain: "eth", dex: "uniswap_v3", order: "changed", limit: "20" })).toEqual({
      kind: "token",
      chain: "eth",
      dex: "uniswap_v3",
      order: "changed",
      limit: 20,
    });
  });

  it("falls back to the defaults for unknown or repeated values", () => {
    expect(parseLatestFilters({ type: "wallet", order: "oldest", limit: "1000" })).toEqual({
      kind: null,
      chain: null,
      dex: null,
      order: "added",
      limit: DEFAULT_LATEST_LIMIT,
    });
    expect(parseLatestFilters({ type: ["pair"], limit: ["20"] }).kind).toBeNull();
    expect(parseLatestFilters({ limit: ["20"] }).limit).toBe(DEFAULT_LATEST_LIMIT);
  });
});
