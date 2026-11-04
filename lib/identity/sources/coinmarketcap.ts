// CoinMarketCap reverse contract-lookup identity source (T1, B1d). A SECOND major
// aggregator alongside CoinGecko: if CMC tracks a token's exact contract, the
// coin is real + listed, so this confirms identity on its own (self-sufficient,
// the same authoritative class as the CoinGecko reverse lookup). Its value is
// breadth — a token CoinGecko never matched but CMC does now gets identified.
// Unlike CoinGecko there's no id to backfill (we don't store a CMC id), so this
// yields only a signal. A miss / no-key / failure degrades to "not found".

import { evmChainId } from "../../chains";
import { CMC_PRO_API_KEY, cmcKeyedRawFetch } from "../../coinmarketcap";
import { IdentitySignal } from "../types";

// Injectable for tests. found = CMC tracks this contract; slug = its currency slug
// (for the token-page link), null when unknown. found:false = definitively
// untracked (CMC's 400); a null result = unknown (no key, transient failure, bad
// key) — treated as "not confirmed", never a false positive.
export type CmcReverseFetcher = (address: string) => Promise<{ found: boolean; slug: string | null } | null>;

const defaultCmcReverseFetch: CmcReverseFetcher = async (address) => {
  if (!CMC_PRO_API_KEY) {
    return null; // CMC has no keyless tier — without a key the source no-ops.
  }
  const res = await cmcKeyedRawFetch(
    `https://pro-api.coinmarketcap.com/v2/cryptocurrency/info?address=${address.toLowerCase()}`,
    "cmc-reverse",
  );
  if (!res) {
    return null; // network/transient
  }
  if (res.status === 200) {
    try {
      const j = await res.json();
      // CMC keys `data` by coin id (or the queried address); any entry ⇒ a tracked
      // contract, and each entry carries a `slug` for the currency page link.
      const data = j?.data;
      if (!data || typeof data !== "object") {
        return { found: false, slug: null };
      }
      const entries = Object.values(data) as Array<{ slug?: unknown }>;
      if (entries.length === 0) {
        return { found: false, slug: null };
      }
      return { found: true, slug: typeof entries[0]?.slug === "string" ? (entries[0].slug as string) : null };
    } catch {
      return null;
    }
  }
  // 400 = CMC's definitive "invalid/untracked address". Other statuses (401 bad
  // key, 5xx, a 429 that survived the back-off) are unknown, not a clean miss.
  if (res.status === 400) {
    return { found: false, slug: null };
  }
  return null;
};

export type CmcReverseResult = { slug: string | null; signal: IdentitySignal };

// Look the contract up on CoinMarketCap. A hit confirms the self-sufficient
// "coinmarketcap" category AND yields the currency slug (for the token-page link;
// the caller backfills it onto the token). Address-based, so EVM chains only.
export async function coinmarketcapReverseIdentity(
  chain: string,
  address: string,
  fetcher: CmcReverseFetcher = defaultCmcReverseFetch,
): Promise<CmcReverseResult> {
  const notFound: CmcReverseResult = {
    slug: null,
    signal: { source: "coinmarketcap", category: "coinmarketcap", confirmed: false, detail: "not found on CoinMarketCap by contract" },
  };
  if (evmChainId(chain) === null) {
    return notFound;
  }
  const r = await fetcher(address);
  if (!r || !r.found) {
    return notFound;
  }
  return {
    slug: r.slug,
    signal: {
      source: "coinmarketcap",
      category: "coinmarketcap",
      confirmed: true,
      detail: r.slug ? `CoinMarketCap: ${r.slug}` : "listed on CoinMarketCap by contract",
    },
  };
}
