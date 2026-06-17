// lib/externalLinks.ts
// Per-token DEEP LINKS to the external tools we already consult, so the operator
// can one-click through to each source's own UI for a token under review
// (Honeypot.is simulation, GoPlus's full signal list, DexScreener chart/socials,
// Blockscout holders, CoinMarketCap). All deterministic from (chain, address) — no
// storage, no fetch. Pure (no prisma import), so it's safe in client components.
// Each builder returns null when the chain isn't supported by that tool.

import { evmChainId } from "./chains";

// Blockscout instance base per chain key (null = no free instance). Shared with
// lib/tokenWebPresence.ts (which uses it as the API base) so the host list lives
// in ONE place. optimism.blockscout.com 301-redirects to explorer.optimism.io
// (undici won't follow it), so point at the final host.
export const BLOCKSCOUT_BASE: Record<string, string | null> = {
  eth: "https://eth.blockscout.com",
  polygon_pos: "https://polygon.blockscout.com",
  xdai: "https://gnosis.blockscout.com",
  base: "https://base.blockscout.com",
  arbitrum: "https://arbitrum.blockscout.com",
  optimism: "https://explorer.optimism.io",
  bsc: null,
};

// DexScreener chain slug per chain key. Shared with lib/tokenWebPresence.ts.
export const DEXSCREENER_CHAIN: Record<string, string> = {
  eth: "ethereum",
  bsc: "bsc",
  polygon_pos: "polygon",
  xdai: "gnosischain",
  base: "base",
  arbitrum: "arbitrum",
  optimism: "optimism",
};

// Honeypot.is web path per chain — ONLY the chains its buy/sell simulation covers
// (eth / bsc / base); a link anywhere else would be dead.
const HONEYPOT_CHAIN: Record<string, string> = {
  eth: "ethereum",
  bsc: "binance-smart-chain",
  base: "base",
};

const lc = (a: string): string => a.toLowerCase();

// GoPlus token-security report (numeric chain id) — covers every EVM chain we map.
export function goPlusUrl(chain: string, address: string): string | null {
  const id = evmChainId(chain);
  return id === null ? null : `https://gopluslabs.io/token-security/${id}/${lc(address)}`;
}

// Honeypot.is buy/sell simulation (eth/bsc/base only).
export function honeypotUrl(chain: string, address: string): string | null {
  const c = HONEYPOT_CHAIN[chain];
  return c ? `https://honeypot.is/${c}?address=${lc(address)}` : null;
}

// DexScreener token page (chart, transactions, socials).
export function dexscreenerUrl(chain: string, address: string): string | null {
  const slug = DEXSCREENER_CHAIN[chain];
  return slug ? `https://dexscreener.com/${slug}/${lc(address)}` : null;
}

// Blockscout token page (holders + transfers). Blockscout accepts either address
// casing, so pass it through as stored (checksummed).
export function blockscoutTokenUrl(chain: string, address: string): string | null {
  const bs = BLOCKSCOUT_BASE[chain];
  return bs ? `${bs}/token/${address}` : null;
}

// Canonical block-explorer base per chain (the chain's primary explorer, e.g. Etherscan) — distinct
// from BLOCKSCOUT_BASE above (a Blockscout instance). A chain not listed has NO explorer link: chiefly
// a non-EVM chain like Osmosis, whose token id is an IBC/factory denom, not a contract address an
// explorer can deep-link by.
export const BLOCK_EXPLORER_BASE: Record<string, string> = {
  eth: "https://etherscan.io",
  bsc: "https://bscscan.com",
  polygon_pos: "https://polygonscan.com",
  arbitrum: "https://arbiscan.io",
  base: "https://basescan.org",
  optimism: "https://optimistic.etherscan.io",
  gnosis: "https://gnosis.blockscout.com",
  xdai: "https://gnosis.blockscout.com",
};

// A token/address page on the chain's block explorer (linkType is "token" or "address"), or null when
// the chain has no explorer mapped — the caller then shows the identifier as plain text instead of a
// broken link.
export function blockExplorerUrl(chain: string, linkType: string, address: string): string | null {
  const base = BLOCK_EXPLORER_BASE[chain];
  return base ? `${base}/${linkType}/${address}` : null;
}

// --- Cosmos (non-EVM) explorer / app links ---
// Mintscan (by Cosmostation) is the de-facto multi-chain Cosmos explorer, but its only deterministic
// deep link is an account/contract page — it cannot deep-link a numeric Osmosis pool id or an
// ibc//factory/ token denom. So a Cosmos chain's identifiers are linked to wherever each actually
// resolves: a bech32 contract → Mintscan; a numeric Osmosis pool → the Osmosis app's pool page; an
// Osmosis token → the Osmosis app's asset page (keyed by symbol); a tokenfactory denom → its issuing
// account on Mintscan. Anything with no reliable target returns null, so the caller shows plain text.

// Mintscan chain slug per dpv chain key (the Cosmos chains we curate).
export const MINTSCAN_CHAIN: Record<string, string> = {
  osmosis: "osmosis",
  neutron: "neutron",
};

// A Cosmos bech32 account/contract address: an HRP, the separator "1", then ≥38 data chars from the
// bech32 charset (which excludes b, i, o and 1). Matches both a 20-byte wallet and a 32-byte contract.
const BECH32_ADDRESS = /^[a-z]{2,}1[ac-hj-np-z02-9]{38,}$/;

// The bech32 creator of a tokenfactory denom: factory/<creator-address>/<subdenom>.
const FACTORY_CREATOR = /^factory\/([a-z]{2,}1[ac-hj-np-z02-9]{38,})\//;

const mintscanAccount = (slug: string, address: string): string => `https://www.mintscan.io/${slug}/account/${address}`;

// A Cosmos explorer/app deep link for a pool address (linkType "address") or token denom (linkType
// "token"), or null when none is reliable. symbol is only used for an Osmosis token, whose app asset
// page is keyed by symbol rather than denom.
export function cosmosExplorerUrl(chain: string, linkType: string, id: string, symbol?: string | null): string | null {
  const slug = MINTSCAN_CHAIN[chain];
  if (!slug) {
    return null;
  }

  // A bech32 contract/account (an Astroport pool contract, a CW20 token) → Mintscan's account page.
  if (BECH32_ADDRESS.test(id)) {
    return mintscanAccount(slug, id);
  }

  // An Osmosis numeric pool id → the canonical Osmosis app pool page.
  if (chain === "osmosis" && linkType === "address" && /^[0-9]+$/.test(id)) {
    return `https://app.osmosis.zone/pool/${id}`;
  }

  // An Osmosis token (an ibc//factory/ denom) → the Osmosis app asset page (keyed by symbol).
  if (chain === "osmosis" && linkType === "token" && symbol) {
    return `https://app.osmosis.zone/assets/${encodeURIComponent(symbol)}`;
  }

  // A tokenfactory token denom → its issuing account/contract on Mintscan (e.g. a Neutron factory denom
  // whose chain has no per-denom asset page; Osmosis factory denoms are already handled above by symbol).
  if (linkType === "token") {
    const creator = id.match(FACTORY_CREATOR);
    if (creator) {
      return mintscanAccount(slug, creator[1]);
    }
  }

  // An ibc//native denom with no reliable per-denom page → caller shows plain text.
  return null;
}

// The explorer link for a token/pool on any supported chain: the EVM block explorer where mapped,
// else the Cosmos resolver. Returns null when neither has a reliable target.
export function explorerUrl(chain: string, linkType: string, id: string, symbol?: string | null): string | null {
  return blockExplorerUrl(chain, linkType, id) ?? cosmosExplorerUrl(chain, linkType, id, symbol);
}

// CoinMarketCap currency page, from the slug B1d backfills ("" = unknown).
export function coinmarketcapUrl(slug: string | null | undefined): string | null {
  return slug ? `https://coinmarketcap.com/currencies/${encodeURIComponent(slug)}/` : null;
}
