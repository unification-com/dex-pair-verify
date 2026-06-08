// Tests for the T1 identity sources + resolver. All network is injected, so
// these are deterministic unit tests.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveTokenIdentity } from "../../lib/identity/resolve";
import { coingeckoReverseIdentity } from "../../lib/identity/sources/coingecko";
import { coinmarketcapReverseIdentity } from "../../lib/identity/sources/coinmarketcap";
import { deriveGoplusIdentity } from "../../lib/identity/sources/goplus";
import { __clearTokenListCache, tokenListMembership, tokenListSignal } from "../../lib/identity/sources/tokenlist";
import { trustWalletIdentity } from "../../lib/identity/sources/trustwallet";

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
      cgReverse: async () => ({ id: null }),
      trustWallet: async () => false,
      cmcReverse: async () => ({ found: false }),
      listMembership: async () => ["uniswap-default"],
      fetchSecurity: async () => ({ trust_list: "1" }),
    });
    expect(result.confirmed).toBe(true);
    expect(result.confirmedCategoryCount).toBe(2);
  });

  it("confirms on a curated token-list match alone (vetted, self-sufficient)", async () => {
    const { result } = await resolveTokenIdentity("eth", ADDR, {
      now: NOW,
      cgReverse: async () => ({ id: null }),
      trustWallet: async () => false,
      cmcReverse: async () => ({ found: false }),
      listMembership: async () => ["uniswap-default"],
      fetchSecurity: async () => null,
    });
    expect(result.confirmed).toBe(true);
    expect(result.confirmedCategoryCount).toBe(1);
  });

  it("does NOT confirm on GoPlus alone when no list vouches (spoof guard)", async () => {
    const { result } = await resolveTokenIdentity("eth", ADDR, {
      now: NOW,
      cgReverse: async () => ({ id: null }),
      trustWallet: async () => false,
      cmcReverse: async () => ({ found: false }),
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
      cgReverse: async () => ({ id: null }),
      trustWallet: async () => false,
      cmcReverse: async () => ({ found: false }),
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

describe("coingeckoReverseIdentity (B1a)", () => {
  it("confirms + returns the coin id when CoinGecko knows the contract", async () => {
    const r = await coingeckoReverseIdentity("eth", ADDR, async () => ({ id: "based-gpt" }));
    expect(r.coinId).toBe("based-gpt");
    expect(r.signal.confirmed).toBe(true);
    expect(r.signal.category).toBe("coingecko");
  });

  it("does not confirm when CoinGecko has no such contract", async () => {
    const r = await coingeckoReverseIdentity("eth", ADDR, async () => ({ id: null }));
    expect(r.coinId).toBeNull();
    expect(r.signal.confirmed).toBe(false);
  });

  it("skips on a non-EVM chain without calling the fetcher", async () => {
    const fetcher = vi.fn(async () => ({ id: "x" }));
    const r = await coingeckoReverseIdentity("qom", ADDR, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(r.coinId).toBeNull();
  });
});

describe("resolveTokenIdentity — CoinGecko self-sufficiency", () => {
  it("confirms on a CoinGecko reverse-lookup hit alone (authoritative) + returns the coin id to backfill", async () => {
    const { result, coingeckoCoinId } = await resolveTokenIdentity("eth", ADDR, {
      now: NOW,
      cgReverse: async () => ({ id: "based-gpt" }),
      trustWallet: async () => false,
      cmcReverse: async () => ({ found: false }),
      listMembership: async () => [],
      fetchSecurity: async () => null,
    });
    expect(result.confirmed).toBe(true);
    expect(coingeckoCoinId).toBe("based-gpt");
  });
});

describe("trustWalletIdentity (B1c)", () => {
  it("confirms (self-sufficient tokenlist) when the contract is in the Trust Wallet registry", async () => {
    const s = await trustWalletIdentity("eth", ADDR, async () => true);
    expect(s.confirmed).toBe(true);
    expect(s.category).toBe("tokenlist");
  });

  it("does not confirm when the contract is absent from the registry", async () => {
    const s = await trustWalletIdentity("eth", ADDR, async () => false);
    expect(s.confirmed).toBe(false);
  });

  it("passes the EIP-55 checksummed address to the fetcher (Trust Wallet paths are case-sensitive)", async () => {
    const fetcher = vi.fn(async () => true);
    await trustWalletIdentity("eth", ADDR.toLowerCase(), fetcher);
    expect(fetcher).toHaveBeenCalledWith("ethereum", ADDR); // ADDR is already checksummed
  });

  it("skips a chain it does not map without calling the fetcher", async () => {
    const fetcher = vi.fn(async () => true);
    const s = await trustWalletIdentity("qom", ADDR, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(s.confirmed).toBe(false);
  });
});

describe("resolveTokenIdentity — Trust Wallet self-sufficiency", () => {
  it("confirms on a Trust Wallet registry hit alone (no list, no GoPlus, no CoinGecko)", async () => {
    const { result } = await resolveTokenIdentity("eth", ADDR, {
      now: NOW,
      cgReverse: async () => ({ id: null }),
      trustWallet: async () => true,
      cmcReverse: async () => ({ found: false }),
      listMembership: async () => [],
      fetchSecurity: async () => null,
    });
    expect(result.confirmed).toBe(true);
    expect(result.confirmedCategoryCount).toBe(1); // the single self-sufficient tokenlist category
  });
});

describe("coinmarketcapReverseIdentity (B1d)", () => {
  it("confirms (self-sufficient) when CoinMarketCap tracks the contract", async () => {
    const s = await coinmarketcapReverseIdentity("eth", ADDR, async () => ({ found: true }));
    expect(s.confirmed).toBe(true);
    expect(s.category).toBe("coinmarketcap");
  });

  it("does not confirm when CoinMarketCap has no such contract", async () => {
    const s = await coinmarketcapReverseIdentity("eth", ADDR, async () => ({ found: false }));
    expect(s.confirmed).toBe(false);
  });

  it("does not confirm on an unknown (transient/no-key) result", async () => {
    const s = await coinmarketcapReverseIdentity("eth", ADDR, async () => null);
    expect(s.confirmed).toBe(false);
  });

  it("skips a non-EVM chain without calling the fetcher", async () => {
    const fetcher = vi.fn(async () => ({ found: true }));
    const s = await coinmarketcapReverseIdentity("qom", ADDR, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(s.confirmed).toBe(false);
  });
});

describe("resolveTokenIdentity — CoinMarketCap self-sufficiency", () => {
  it("confirms on a CoinMarketCap reverse-lookup hit alone (second aggregator)", async () => {
    const { result } = await resolveTokenIdentity("eth", ADDR, {
      now: NOW,
      cgReverse: async () => ({ id: null }),
      trustWallet: async () => false,
      cmcReverse: async () => ({ found: true }),
      listMembership: async () => [],
      fetchSecurity: async () => null,
    });
    expect(result.confirmed).toBe(true);
    expect(result.confirmedCategoryCount).toBe(1); // the single self-sufficient coinmarketcap category
  });
});
