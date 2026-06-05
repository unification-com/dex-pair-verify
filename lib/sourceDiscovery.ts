// lib/sourceDiscovery.ts
// Phase 4, 4.A.1 — auto-discover new (network, dex) sources from GeckoTerminal
// and diff them against what we already support / have already triaged, so the
// operator only ever sees genuinely-new candidates.
//
// GeckoTerminal exposes only id+name per dex (Q1) — no subgraph URL or factory —
// so discovery writes a bare Pending candidate keyed by the GT (network, dex)
// slug; the operational fields (subgraph template, factory, RPC) arrive when the
// operator pastes + verifies a subgraph at promotion (lib/subgraphVerify.ts / T6.4).
//
// Pure helpers live here so the diff is unit-testable without hitting GT; the
// fetch loops + DB writes live in import/discover.ts (mirrors gtVerify.ts ↔
// verify_gt.ts).

import { getSourceByIndex, gtDexFor, gtNetworkFor, sourceCount } from "./sourceConfig";

// A GT (network, dex) tuple as discovered — the candidate's identity until an
// operator maps it onto internal chain/dex ids at promotion. A discovered
// candidate stores these GT slugs in CandidateDexNetwork.chain / .dex.
export type DiscoveredSource = { gtNetwork: string; gtDex: string };

// `${gtNetwork}/${gtDex}` — the dedupe key for a discovered tuple.
export const discoveryKey = (gtNetwork: string, gtDex: string): string => `${gtNetwork}/${gtDex}`;

// The GT (network, dex) keys we already wire via lib/sources.js. Discovery never
// re-surfaces these. Built from the live source config so it tracks edits, and
// resolves each source's GT slugs (which can differ from our internal ids, e.g.
// dex `bsc_pancakeswap_v3` → GT `pancakeswap-v3-bsc`).
//
// NOTE (T6.5): once lib/sources.js is retired into SupportedSource, fold the
// migrated rows' GT keys in here too, or discovery will re-surface them.
export function supportedGtKeys(): Set<string> {
  const keys = new Set<string>();
  for (let i = 0; i < sourceCount; i += 1) {
    const s = getSourceByIndex(i);
    if (s) {
      keys.add(discoveryKey(gtNetworkFor(s), gtDexFor(s)));
    }
  }
  return keys;
}

// The curated EVM network scope for discovery: the existing supported networks
// (new DEXs surface on them — 4.D Tier A) plus the 4.D Tier-B new chains. Non-EVM
// (Solana / Cosmos) is deliberately excluded until go-ooo can serve it — see the
// modular tracker's "Future — non-EVM breadth" section. Grow this list when that
// lands. The CLI accepts explicit network args to scan anything ad hoc.
export const DISCOVERY_NETWORKS = [
  "eth",
  "polygon_pos",
  "xdai",
  "bsc",
  "arbitrum",
  "base",
  "optimism",
  "avax",
];

// The DEX families the operator wants to onboard (the 4.D target catalogue).
// By default discovery surfaces a GT dex only when its slug matches one of these,
// keeping the review inbox actionable: GeckoTerminal lists ~130+ DEXs per chain,
// almost all tiny forks or dead AMMs, with no liquidity data on the /dexes
// endpoint to rank by (Q1). The `all` option (CLI `--all`) bypasses the filter to
// surface the full firehose on demand.
export const TARGET_DEX_FAMILIES = [
  "uniswap",
  "sushiswap",
  "pancakeswap",
  "quickswap",
  "shibaswap",
  "honeyswap",
  "aerodrome",
  "velodrome",
  "camelot",
  "thena",
  "biswap",
];

// True when a GT dex slug belongs to a target family (case-insensitive substring,
// so slug variants like `pancakeswap_v2` / `uniswap-v3-base` all match). Over-
// matching is harmless — it just surfaces one extra row for the operator to
// reject — whereas under-matching would silently drop a real target.
export function matchesTargetFamily(gtDex: string): boolean {
  const slug = gtDex.toLowerCase();
  return TARGET_DEX_FAMILIES.some((fam) => slug.includes(fam));
}

// Pure: from one network's GT dex set, the tuples we neither already support nor
// have already triaged, curated to the target families (unless `all`). Any
// existing candidate — Pending (already queued), Enabled (already promoted) or
// Rejected (operator dismissed, D4) — counts as triaged, so a dismissed or
// promoted source is never re-surfaced.
export function newSourcesForNetwork(
  gtNetwork: string,
  gtDexes: Set<string>,
  supported: Set<string>,
  knownCandidates: Set<string>,
  opts: { all?: boolean } = {},
): DiscoveredSource[] {
  const out: DiscoveredSource[] = [];
  for (const gtDex of Array.from(gtDexes)) {
    const key = discoveryKey(gtNetwork, gtDex);
    if (supported.has(key) || knownCandidates.has(key)) {
      continue;
    }
    if (!opts.all && !matchesTargetFamily(gtDex)) {
      continue;
    }
    out.push({ gtNetwork, gtDex });
  }
  return out;
}
