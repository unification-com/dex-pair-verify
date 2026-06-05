// lib/tokenWebPresence.ts
// Free DECISION-SUPPORT lookups for a token detail view: GeckoTerminal token info
// (website / socials / description / logo) + Blockscout holder count. Surfaced to
// the operator so an "is this a real project?" call on an unidentified token is a
// glance, not a research task (e.g. ARQ → arqen.trade · @arqentrade · 254 holders).
//
// NB: these signals are NOT a trust gate — AV-5 proved they're gameable (a spoof
// can register a website / airdrop holders), so they inform the human, never
// auto-verify. On-demand, cached in-process (1h TTL); every fetch degrades to a
// blank field on failure/timeout and NEVER blocks the page.

import { evmChainId } from "./chains";

export type TokenWebPresence = {
  websites: string[];
  twitter: string | null;
  telegram: string | null;
  discord: string | null;
  description: string | null;
  imageUrl: string | null;
  holders: number | null;
  transfers: number | null;
};

// GeckoTerminal network slug + Blockscout base per chain key (null = no free
// Blockscout instance, so holders are unavailable there — GT info still works).
const GT_NET: Record<string, string> = { eth: "eth", polygon_pos: "polygon_pos", bsc: "bsc", xdai: "xdai" };
const BLOCKSCOUT: Record<string, string | null> = {
  eth: "https://eth.blockscout.com",
  polygon_pos: "https://polygon.blockscout.com",
  xdai: "https://gnosis.blockscout.com",
  bsc: null,
};

const TTL_MS = 60 * 60 * 1000; // 1h — web presence + holders move slowly
const cache = new Map<string, { data: TokenWebPresence; at: number }>();
const blank = (): TokenWebPresence => ({ websites: [], twitter: null, telegram: null, discord: null, description: null, imageUrl: null, holders: null, transfers: null });

const fetchT = async (url: string, init?: RequestInit, ms = 4000): Promise<Response | null> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

export async function fetchTokenWebPresence(chain: string, address: string, now = Date.now()): Promise<TokenWebPresence> {
  const key = `${chain}:${address.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached && now - cached.at < TTL_MS) {
    return cached.data;
  }
  const data = blank();

  // Only EVM chains we map have these explorers.
  if (evmChainId(chain) !== null) {
    const gtNet = GT_NET[chain];
    if (gtNet) {
      const r = await fetchT(`https://api.geckoterminal.com/api/v2/networks/${gtNet}/tokens/${address}/info`, { headers: { Accept: "application/json" } });
      if (r?.ok) {
        try {
          const j = await r.json();
          const a = (j?.data?.attributes ?? {}) as Record<string, unknown>;
          if (Array.isArray(a.websites)) data.websites = (a.websites as unknown[]).filter((w): w is string => typeof w === "string" && w.length > 0);
          data.twitter = typeof a.twitter_handle === "string" && a.twitter_handle ? `https://twitter.com/${a.twitter_handle}` : null;
          data.telegram = typeof a.telegram_handle === "string" && a.telegram_handle ? `https://t.me/${a.telegram_handle}` : null;
          data.discord = typeof a.discord_url === "string" && a.discord_url ? a.discord_url : null;
          data.description = typeof a.description === "string" && a.description.length > 0 ? a.description : null;
          data.imageUrl = typeof a.image_url === "string" && a.image_url && a.image_url !== "missing.png" ? a.image_url : null;
        } catch { /* non-JSON — leave blank */ }
      }
    }
    const bs = BLOCKSCOUT[chain];
    if (bs) {
      // /counters returns both token_holders_count + transfers_count.
      const r = await fetchT(`${bs}/api/v2/tokens/${address}/counters`);
      if (r?.ok) {
        try {
          const j = await r.json();
          data.holders = j.token_holders_count != null ? Number(j.token_holders_count) : null;
          data.transfers = j.transfers_count != null ? Number(j.transfers_count) : null;
        } catch { /* leave blank */ }
      }
    }
  }

  cache.set(key, { data, at: now });
  return data;
}
