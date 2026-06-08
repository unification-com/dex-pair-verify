// lib/tokenWebPresence.ts
// Free DECISION-SUPPORT lookups for a token detail view: GeckoTerminal token info
// (website / socials / description / logo), Blockscout holder count + holder
// concentration (top non-contract holder's share — a centralisation / rug-risk
// cue), and a DexScreener socials fall-back for tokens GeckoTerminal has no links
// for. Surfaced to the operator so an "is this a real project?" call on an
// unidentified token is a glance, not a research task.
//
// NB: these signals are NOT a trust gate — AV-5 proved they're gameable (a spoof
// can register a website / airdrop holders), so they inform the human, never
// auto-verify. Write-through cached on the Token row (getTokenWebPresence persists
// on first discovery and reads the stored copy until it goes stale); every fetch
// degrades to a blank field on failure/timeout and NEVER blocks the page.

import { Prisma } from "@prisma/client";

import { evmChainId } from "./chains";
import { BLOCKSCOUT_BASE, DEXSCREENER_CHAIN } from "./externalLinks";
import prisma from "./prisma";

export type TokenWebPresence = {
  websites: string[];
  twitter: string | null;
  telegram: string | null;
  discord: string | null;
  description: string | null;
  imageUrl: string | null;
  holders: number | null;
  topHolderPercent: number | null; // % of supply held by the largest NON-contract holder
};

// GeckoTerminal network slug per chain key (null/absent = GT info not fetched).
const GT_NET: Record<string, string> = {
  eth: "eth",
  polygon_pos: "polygon_pos",
  bsc: "bsc",
  xdai: "xdai",
  base: "base",
  arbitrum: "arbitrum",
  optimism: "optimism",
};

// Blockscout instance base + DexScreener slug per chain are shared with
// lib/externalLinks.ts (which also builds the public token-page deep-links), so
// the chain maps live in ONE place. `BLOCKSCOUT_BASE` null = no free Blockscout
// instance there (holders/concentration unavailable; GT + DexScreener still work).

// How long a stored copy is trusted before a re-fetch (web presence + holders
// move slowly).
const STORE_TTL_S = 7 * 24 * 60 * 60; // 7 days
const blank = (): TokenWebPresence => ({
  websites: [],
  twitter: null,
  telegram: null,
  discord: null,
  description: null,
  imageUrl: null,
  holders: null,
  topHolderPercent: null,
});

// Only let http(s) URLs through into hrefs / img src. GeckoTerminal / DexScreener
// token info is operator-submittable, so a malicious token could carry a
// `javascript:`/`data:` URI → stored XSS when the operator clicks. `httpsOnly`
// for image sources.
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

type GtInfo = Pick<TokenWebPresence, "websites" | "twitter" | "telegram" | "discord" | "description" | "imageUrl">;

// GeckoTerminal token info → website / socials / description / logo.
async function fetchGtInfo(chain: string, address: string): Promise<GtInfo> {
  const out: GtInfo = { websites: [], twitter: null, telegram: null, discord: null, description: null, imageUrl: null };
  const gtNet = GT_NET[chain];
  if (!gtNet) {
    return out;
  }
  const r = await fetchT(`https://api.geckoterminal.com/api/v2/networks/${gtNet}/tokens/${address}/info`, { headers: { Accept: "application/json" } });
  if (!r?.ok) {
    return out;
  }
  try {
    const j = await r.json();
    const a = (j?.data?.attributes ?? {}) as Record<string, unknown>;
    if (Array.isArray(a.websites)) out.websites = (a.websites as unknown[]).filter((w): w is string => typeof w === "string" && safeUrl(w) !== null);
    out.twitter = typeof a.twitter_handle === "string" && a.twitter_handle ? `https://twitter.com/${encodeURIComponent(a.twitter_handle)}` : null;
    out.telegram = typeof a.telegram_handle === "string" && a.telegram_handle ? `https://t.me/${encodeURIComponent(a.telegram_handle)}` : null;
    out.discord = typeof a.discord_url === "string" ? safeUrl(a.discord_url) : null;
    out.description = typeof a.description === "string" && a.description.length > 0 ? a.description : null;
    out.imageUrl = typeof a.image_url === "string" && a.image_url !== "missing.png" ? safeUrl(a.image_url, true) : null;
  } catch {
    /* non-JSON — leave blank */
  }
  return out;
}

// Blockscout holder stats from two fast calls: the token record (holder count +
// total supply) and the holders list (largest-first). Concentration = the largest
// NON-contract holder's share of supply — a centralisation / rug-risk cue (one EOA
// can dump). total_supply + value are raw integer strings in the same units, so
// decimals cancel in the ratio; BigInt avoids float overflow. (The /counters
// endpoint also gives a transfer count but is slow + flaky under load, so we get
// the holder count from the token record instead.)
async function fetchHolderStats(bs: string, address: string): Promise<{ holders: number | null; topHolderPercent: number | null }> {
  const [tokRes, holdRes] = await Promise.all([
    fetchT(`${bs}/api/v2/tokens/${address}`),
    fetchT(`${bs}/api/v2/tokens/${address}/holders`),
  ]);
  const out: { holders: number | null; topHolderPercent: number | null } = { holders: null, topHolderPercent: null };
  if (!tokRes?.ok) {
    return out;
  }
  let totalSupply = BigInt(0);
  try {
    const tok = await tokRes.json();
    out.holders = tok?.holders_count != null ? Number(tok.holders_count) : null;
    totalSupply = tok?.total_supply != null ? BigInt(String(tok.total_supply)) : BigInt(0);
  } catch {
    return out;
  }
  if (totalSupply <= BigInt(0) || !holdRes?.ok) {
    return out;
  }
  try {
    const hold = await holdRes.json();
    const items = Array.isArray(hold?.items) ? hold.items : [];
    for (const it of items) {
      if (it?.address?.is_contract === true) {
        continue;
      }
      const value = BigInt(String(it?.value ?? "0"));
      out.topHolderPercent = Number((value * BigInt(10_000)) / totalSupply) / 100; // 2 dp
      break;
    }
  } catch {
    /* leave topHolderPercent null */
  }
  return out;
}

// DexScreener socials/websites — the fall-back when GeckoTerminal has no links.
async function fetchDexScreenerLinks(chain: string, address: string): Promise<Partial<GtInfo> | null> {
  const slug = DEXSCREENER_CHAIN[chain];
  if (!slug) {
    return null;
  }
  const r = await fetchT(`https://api.dexscreener.com/latest/dex/tokens/${address}`, { headers: { Accept: "application/json" } });
  if (!r?.ok) {
    return null;
  }
  try {
    const j = await r.json();
    const pairs = Array.isArray(j?.pairs) ? j.pairs : [];
    const info = (pairs.find((p: Record<string, unknown>) => p?.chainId === slug && p?.info) as { info?: Record<string, unknown> } | undefined)?.info;
    if (!info) {
      return null;
    }
    const websites = Array.isArray(info.websites)
      ? (info.websites as { url?: unknown }[]).map((w) => safeUrl(String(w?.url ?? ""))).filter((u): u is string => u !== null)
      : [];
    const socials = Array.isArray(info.socials) ? (info.socials as { type?: unknown; url?: unknown }[]) : [];
    const byType = (t: string): string | null => {
      const s = socials.find((x) => String(x?.type).toLowerCase() === t);
      return s ? safeUrl(String(s.url ?? "")) : null;
    };
    return { websites, twitter: byType("twitter"), telegram: byType("telegram"), discord: byType("discord") };
  } catch {
    return null;
  }
}

// Pure network fetch (GeckoTerminal + Blockscout + DexScreener). No caching here —
// the DB write-through in getTokenWebPresence is the cache. Independent lookups run
// concurrently; the DexScreener fall-back runs only when GT yielded no links.
export async function fetchTokenWebPresence(chain: string, address: string): Promise<TokenWebPresence> {
  const data = blank();
  if (evmChainId(chain) === null) {
    return data; // only EVM chains we map have these explorers
  }

  const bs = BLOCKSCOUT_BASE[chain];
  const [gt, holderStats] = await Promise.all([
    fetchGtInfo(chain, address),
    bs ? fetchHolderStats(bs, address) : Promise.resolve({ holders: null, topHolderPercent: null }),
  ]);
  Object.assign(data, gt);
  data.holders = holderStats.holders;
  data.topHolderPercent = holderStats.topHolderPercent;

  // DexScreener fall-back — fill the socials/sites GeckoTerminal didn't have.
  const hasLinks = data.websites.length > 0 || !!data.twitter || !!data.telegram || !!data.discord;
  if (!hasLinks) {
    const ds = await fetchDexScreenerLinks(chain, address);
    if (ds) {
      if (ds.websites && ds.websites.length) data.websites = ds.websites;
      data.twitter = data.twitter ?? ds.twitter ?? null;
      data.telegram = data.telegram ?? ds.telegram ?? null;
      data.discord = data.discord ?? ds.discord ?? null;
    }
  }

  return data;
}

// DB write-through resolver. Returns the stored copy off the already-loaded token
// row when it's fresh (no extra read / no network); otherwise fetches live and
// persists it back to the row (best-effort — a write failure still returns the
// fetched data). Pass the token row straight from the page's findUnique. `force`
// bypasses the cache (the operator "Run security scan" button refreshes it).
export async function getTokenWebPresence(
  token: { id: string; chain: string; contractAddress: string; webPresence: unknown; webPresenceCheckedAt: number },
  now = Math.floor(Date.now() / 1000),
  opts: { force?: boolean } = {},
): Promise<TokenWebPresence> {
  if (!opts.force && token.webPresence && token.webPresenceCheckedAt > 0 && now - token.webPresenceCheckedAt < STORE_TTL_S) {
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
