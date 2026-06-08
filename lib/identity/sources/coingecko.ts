// CoinGecko reverse contract-lookup identity source (T1, B1a). The most
// authoritative identity signal: does CoinGecko know this exact contract? If so
// the coin is real + listed, and the returned coin id is fed back to BACKFILL
// Token.coingeckoCoinId — so a token GeckoTerminal never matched becomes properly
// CG-listed (identity via cgId, and the canonical-address check can now run). A
// miss / 404 / failure degrades to "not found", never an error.

import { cgPlatformForChain } from "../../canonical";
import { cgKeyedFetch } from "../../coingecko";
import { IdentitySignal } from "../types";

// Injectable for tests. Returns { id } (id null = CG has no such contract), or
// null for a transient failure (treated as "unknown", not "absent").
export type CgReverseFetcher = (platform: string, address: string) => Promise<{ id: string | null } | null>;

const defaultCgReverseFetch: CgReverseFetcher = async (platform, address) => {
  const res = await cgKeyedFetch(`https://api.coingecko.com/api/v3/coins/${platform}/contract/${address.toLowerCase()}`, `cg-reverse ${platform}`);
  if (!res) {
    return null; // transient — caller treats as unknown
  }
  if (res.status === 404) {
    return { id: null }; // definitive: CoinGecko doesn't track this contract
  }
  if (!res.ok) {
    return null;
  }
  try {
    const j = await res.json();
    return { id: typeof j?.id === "string" && j.id ? j.id : null };
  } catch {
    return null;
  }
};

export type CgReverseResult = { coinId: string | null; signal: IdentitySignal };

// Look the contract up on CoinGecko. coinId non-null ⇒ the caller backfills it
// onto the token (and the self-sufficient "coingecko" signal confirms identity).
export async function coingeckoReverseIdentity(
  chain: string,
  address: string,
  fetcher: CgReverseFetcher = defaultCgReverseFetch,
): Promise<CgReverseResult> {
  const notFound: CgReverseResult = {
    coinId: null,
    signal: { source: "coingecko", category: "coingecko", confirmed: false, detail: "not found on CoinGecko by contract" },
  };
  const platform = cgPlatformForChain(chain);
  if (!platform) {
    return notFound;
  }
  const r = await fetcher(platform, address);
  if (!r || !r.id) {
    return notFound;
  }
  return {
    coinId: r.id,
    signal: { source: "coingecko", category: "coingecko", confirmed: true, detail: `CoinGecko coin: ${r.id}` },
  };
}
