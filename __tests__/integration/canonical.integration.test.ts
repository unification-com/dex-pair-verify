// Integration tests for fetchCanonicalContract — the CoinGecko canonical
// contract lookup + 30-day CanonicalAddress cache (A.2). The CoinGecko HTTP
// call is stubbed via the injectable `fetcher` so these exercise the cache
// logic against the real test DB without a live network call.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetDb, testPrisma } from "./helpers";
import { fetchCanonicalContract } from "../../lib/canonical";

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // checksummed
const USDC_LOWER = USDC.toLowerCase();
const NOW = 1_700_000_000;

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("fetchCanonicalContract", () => {
  it("fetches, checksums and caches the canonical address", async () => {
    const fetcher = vi.fn(async () => ({ ethereum: USDC_LOWER }));

    const addr = await fetchCanonicalContract("usd-coin", "eth", { now: NOW, fetcher });

    expect(addr).toBe(USDC); // checksummed
    expect(fetcher).toHaveBeenCalledTimes(1);
    const row = await testPrisma.canonicalAddress.findUnique({
      where: { coingeckoCoinId_chain: { coingeckoCoinId: "usd-coin", chain: "eth" } },
    });
    expect(row?.contractAddress).toBe(USDC);
    expect(row?.lastChecked).toBe(NOW);
  });

  it("serves a fresh cache hit without calling the fetcher again", async () => {
    const fetcher = vi.fn(async () => ({ ethereum: USDC_LOWER }));
    await fetchCanonicalContract("usd-coin", "eth", { now: NOW, fetcher });

    // 29 days later — still inside the 30d TTL.
    const addr = await fetchCanonicalContract("usd-coin", "eth", {
      now: NOW + 29 * 24 * 60 * 60,
      fetcher,
    });

    expect(addr).toBe(USDC);
    expect(fetcher).toHaveBeenCalledTimes(1); // not re-fetched
  });

  it("re-fetches once the 30-day TTL has expired", async () => {
    const fetcher = vi.fn(async () => ({ ethereum: USDC_LOWER }));
    await fetchCanonicalContract("usd-coin", "eth", { now: NOW, fetcher });

    const addr = await fetchCanonicalContract("usd-coin", "eth", {
      now: NOW + 31 * 24 * 60 * 60,
      fetcher,
    });

    expect(addr).toBe(USDC);
    expect(fetcher).toHaveBeenCalledTimes(2); // TTL expired -> re-fetched
  });

  it("caches a negative result as empty string and returns null", async () => {
    // Coin has no contract on this chain (platforms map lacks the platform).
    const fetcher = vi.fn(async () => ({ "polygon-pos": USDC_LOWER }));

    const addr = await fetchCanonicalContract("usd-coin", "eth", { now: NOW, fetcher });

    expect(addr).toBeNull();
    const row = await testPrisma.canonicalAddress.findUnique({
      where: { coingeckoCoinId_chain: { coingeckoCoinId: "usd-coin", chain: "eth" } },
    });
    expect(row?.contractAddress).toBe(""); // negative cached
  });

  it("returns null without any DB write for a chain not on CoinGecko (qom)", async () => {
    const fetcher = vi.fn(async () => ({ ethereum: USDC_LOWER }));

    const addr = await fetchCanonicalContract("some-coin", "qom", { now: NOW, fetcher });

    expect(addr).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await testPrisma.canonicalAddress.count()).toBe(0);
  });

  it("does NOT cache on a transient fetch failure (e.g. a 429), so it retries", async () => {
    // defaultPlatformsFetcher returns null on any non-200 — simulate that.
    const failing = vi.fn(async () => null);
    const addr = await fetchCanonicalContract("usd-coin", "eth", { now: NOW, fetcher: failing });

    expect(addr).toBeNull();
    // No row written — the cache is not poisoned with a negative answer.
    expect(await testPrisma.canonicalAddress.count()).toBe(0);

    // A later successful call resolves and caches normally.
    const ok = vi.fn(async () => ({ ethereum: USDC_LOWER }));
    const addr2 = await fetchCanonicalContract("usd-coin", "eth", { now: NOW, fetcher: ok });
    expect(addr2).toBe(USDC);
  });

  it("returns null for an empty coin id", async () => {
    const addr = await fetchCanonicalContract("", "eth", { now: NOW });
    expect(addr).toBeNull();
    expect(await testPrisma.canonicalAddress.count()).toBe(0);
  });
});
