// Tests for the T1 identity sources + resolver. All network is injected, so
// these are deterministic unit tests.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveTokenIdentity } from "../../lib/identity/resolve";
import { deriveGoplusIdentity } from "../../lib/identity/sources/goplus";
import { __clearTokenListCache, tokenListMembership, tokenListSignal } from "../../lib/identity/sources/tokenlist";

const NOW = 1_700_000_000;
const ADDR = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

describe("deriveGoplusIdentity", () => {
  it("confirms a token on the GoPlus trust list", () => {
    const s = deriveGoplusIdentity({ trust_list: "1" });
    expect(s.confirmed).toBe(true);
    expect(s.category).toBe("security-api");
  });

  it("confirms an open-source contract with a healthy holder base", () => {
    expect(deriveGoplusIdentity({ is_open_source: "1", holder_count: "5000" }).confirmed).toBe(true);
  });

  it("does NOT confirm open-source with a thin holder base", () => {
    expect(deriveGoplusIdentity({ is_open_source: "1", holder_count: "12" }).confirmed).toBe(false);
  });

  it("does NOT confirm when there is no GoPlus data", () => {
    expect(deriveGoplusIdentity(null).confirmed).toBe(false);
  });
});

describe("tokenListSignal", () => {
  it("confirms membership in ≥1 list", () => {
    const s = tokenListSignal(["uniswap-default"]);
    expect(s.confirmed).toBe(true);
    expect(s.category).toBe("tokenlist");
  });

  it("does not confirm when on no list", () => {
    expect(tokenListSignal([]).confirmed).toBe(false);
  });
});

describe("tokenListMembership", () => {
  beforeEach(() => __clearTokenListCache());

  it("matches a token present in a fetched list (case-insensitive) and caches the fetch", async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.includes("uniswap")
        ? { tokens: [{ chainId: 1, address: ADDR.toLowerCase() }] }
        : { tokens: [] },
    );
    const matched = await tokenListMembership(1, ADDR, { fetcher, now: NOW });
    expect(matched).toContain("uniswap-default");

    // Second lookup within TTL must not re-fetch (served from cache).
    const before = fetcher.mock.calls.length;
    await tokenListMembership(1, ADDR, { fetcher, now: NOW });
    expect(fetcher.mock.calls.length).toBe(before);
  });

  it("returns no match for a different chain id", async () => {
    const fetcher = vi.fn(async () => ({ tokens: [{ chainId: 1, address: ADDR }] }));
    expect(await tokenListMembership(137, ADDR, { fetcher, now: NOW })).toEqual([]);
  });
});

describe("resolveTokenIdentity", () => {
  it("confirms when a token list AND GoPlus both vouch (two categories)", async () => {
    const { result } = await resolveTokenIdentity("eth", ADDR, {
      now: NOW,
      listMembership: async () => ["uniswap-default"],
      fetchSecurity: async () => ({ trust_list: "1" }),
    });
    expect(result.confirmed).toBe(true);
    expect(result.confirmedCategoryCount).toBe(2);
  });

  it("confirms on a curated token-list match alone (vetted, self-sufficient)", async () => {
    const { result } = await resolveTokenIdentity("eth", ADDR, {
      now: NOW,
      listMembership: async () => ["uniswap-default"],
      fetchSecurity: async () => null,
    });
    expect(result.confirmed).toBe(true);
    expect(result.confirmedCategoryCount).toBe(1);
  });

  it("does NOT confirm on GoPlus alone when no list vouches (spoof guard)", async () => {
    const { result } = await resolveTokenIdentity("eth", ADDR, {
      now: NOW,
      listMembership: async () => [],
      fetchSecurity: async () => ({ trust_list: "1" }),
    });
    expect(result.confirmed).toBe(false);
    expect(result.confirmedCategoryCount).toBe(1);
  });

  it("reuses existing GoPlus data instead of fetching", async () => {
    const fetchSecurity = vi.fn(async () => null);
    const { result } = await resolveTokenIdentity("eth", ADDR, {
      now: NOW,
      existingSecurity: { trust_list: "1" },
      listMembership: async () => ["uniswap-default"],
      fetchSecurity,
    });
    expect(fetchSecurity).not.toHaveBeenCalled();
    expect(result.confirmed).toBe(true);
  });

  it("skips both sources on a non-EVM chain (qom — on neither token lists nor GoPlus)", async () => {
    const listMembership = vi.fn(async () => ["x"]);
    const fetchSecurity = vi.fn(async () => ({ trust_list: "1" }));
    const { result } = await resolveTokenIdentity("qom", ADDR, { now: NOW, listMembership, fetchSecurity });
    // No EVM id → token-list source not run; no GoPlus chain id → no fetch.
    expect(listMembership).not.toHaveBeenCalled();
    expect(fetchSecurity).not.toHaveBeenCalled();
    expect(result.confirmedCategoryCount).toBe(0);
    expect(result.confirmed).toBe(false);
  });
});
