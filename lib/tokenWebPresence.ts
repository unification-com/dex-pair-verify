// lib/tokenWebPresence.ts
// Free DECISION-SUPPORT lookups for a token detail view: GeckoTerminal token info
// (website / socials / description / logo) + Blockscout holder count. Surfaced to
// the operator so an "is this a real project?" call on an unidentified token is a
// glance, not a research task (e.g. ARQ → arqen.trade · @arqentrade · 254 holders).
//
// NB: these signals are NOT a trust gate — AV-5 proved they're gameable (a spoof
// can register a website / airdrop holders), so they inform the human, never
// auto-verify. Write-through cached on the Token row (getTokenWebPresence persists
// on first discovery and reads the stored copy until it goes stale); every fetch
// degrades to a blank field on failure/timeout and NEVER blocks the page.

import { Prisma } from "@prisma/client";

import { evmChainId } from "./chains";
import prisma from "./prisma";

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

// How long a stored copy is trusted before a re-fetch (web presence + holders
// move slowly).
const STORE_TTL_S = 7 * 24 * 60 * 60; // 7 days
const blank = (): TokenWebPresence => ({ websites: [], twitter: null, telegram: null, discord: null, description: null, imageUrl: null, holders: null, transfers: null });

// Only let http(s) URLs through into hrefs / img src. GeckoTerminal token info is
// operator-submittable, so a malicious token could carry a `javascript:`/`data:`
// URI → stored XSS when the operator clicks. `httpsOnly` for image sources.
const safeUrl = (u: string, httpsOnly = false): string | null => {
  try {
    const p = new URL(u);
    return p.protocol === "https:" || (!httpsOnly && p.protocol === "http:") ? u : null;
  } catch {
    return null;
  }
};

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

// Pure network fetch (GeckoTerminal + Blockscout). No caching here — the DB
// write-through in getTokenWebPresence is the cache.
export async function fetchTokenWebPresence(chain: string, address: string): Promise<TokenWebPresence> {
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
          if (Array.isArray(a.websites)) data.websites = (a.websites as unknown[]).filter((w): w is string => typeof w === "string" && safeUrl(w) !== null);
          data.twitter = typeof a.twitter_handle === "string" && a.twitter_handle ? `https://twitter.com/${encodeURIComponent(a.twitter_handle)}` : null;
          data.telegram = typeof a.telegram_handle === "string" && a.telegram_handle ? `https://t.me/${encodeURIComponent(a.telegram_handle)}` : null;
          data.discord = typeof a.discord_url === "string" ? safeUrl(a.discord_url) : null;
          data.description = typeof a.description === "string" && a.description.length > 0 ? a.description : null;
          data.imageUrl = typeof a.image_url === "string" && a.image_url !== "missing.png" ? safeUrl(a.image_url, true) : null;
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

  return data;
}

// DB write-through resolver. Returns the stored copy off the already-loaded token
// row when it's fresh (no extra read / no network); otherwise fetches live and
// persists it back to the row (best-effort — a write failure still returns the
// fetched data). Pass the token row straight from the page's findUnique.
export async function getTokenWebPresence(
  token: { id: string; chain: string; contractAddress: string; webPresence: unknown; webPresenceCheckedAt: number },
  now = Math.floor(Date.now() / 1000),
): Promise<TokenWebPresence> {
  if (token.webPresence && token.webPresenceCheckedAt > 0 && now - token.webPresenceCheckedAt < STORE_TTL_S) {
    return token.webPresence as TokenWebPresence;
  }
  const data = await fetchTokenWebPresence(token.chain, token.contractAddress);
  try {
    await prisma.token.update({
      where: { id: token.id },
      data: { webPresence: data as unknown as Prisma.InputJsonValue, webPresenceCheckedAt: now },
    });
  } catch {
    // persistence is best-effort — never block the page on a write failure
  }
  return data;
}
