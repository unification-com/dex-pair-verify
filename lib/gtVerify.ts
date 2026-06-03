// Verify our source definitions against GeckoTerminal's live network + dex
// lists (GET /networks, GET /networks/{network}/dexes) so a wrong slug is
// caught before it silently ingests nothing. The pure verify step is split out
// for testing; the fetch loops live in import/verify_gt.ts.

import { gtDexFor, gtNetworkFor, SourceEntry } from "./sourceConfig";

const GT_BASE = "https://api.geckoterminal.com/api/v2";

export type SourceVerdict = {
  chain: string;
  dex: string;
  gtNetwork: string;
  gtDex: string;
  networkOk: boolean;
  dexOk: boolean;
  candidates: string[]; // close dex slugs when dexOk is false
};

// The GT dex list for one network: `found` is false when the network itself
// isn't on GeckoTerminal (404).
export type NetworkDexes = { found: boolean; dexes: Set<string> };

// Pure: classify one source against the per-network dex sets.
export function verifySource(
  source: SourceEntry,
  dexesByNetwork: Record<string, NetworkDexes>,
): SourceVerdict {
  const gtNetwork = gtNetworkFor(source);
  const gtDex = gtDexFor(source);
  const net = dexesByNetwork[gtNetwork] ?? { found: false, dexes: new Set<string>() };
  const networkOk = net.found;
  const dexOk = networkOk && net.dexes.has(gtDex);

  let candidates: string[] = [];
  if (networkOk && !dexOk) {
    // Suggest GT dex slugs that share a meaningful token with our id.
    const parts = source.dex.split(/[_-]/).filter((p) => p.length > 2);
    candidates = Array.from(net.dexes).filter((d) => parts.some((p) => d.includes(p)));
  }

  return { chain: source.chain, dex: source.dex, gtNetwork, gtDex, networkOk, dexOk, candidates };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetch a network's full GeckoTerminal dex list. Returns found=false on a 404
// (network not on GT). Backs off once on a 429 so the free-tier rate limit
// doesn't produce a false-empty result.
export async function fetchGtDexes(network: string, sleepMs = 2500): Promise<NetworkDexes> {
  const dexes = new Set<string>();
  let found = true;

  for (let page = 1; page <= 15; page += 1) {
    let res = await fetch(`${GT_BASE}/networks/${network}/dexes?page=${page}`);
    if (res.status === 429) {
      await sleep(65_000); // GT window is per-minute — wait it out, then retry
      res = await fetch(`${GT_BASE}/networks/${network}/dexes?page=${page}`);
    }
    if (res.status === 404) {
      found = false;
      break;
    }
    if (!res.ok) {
      break;
    }
    const json = await res.json();
    const data = (json?.data as { id: string }[]) ?? [];
    if (data.length === 0) {
      break;
    }
    for (const d of data) {
      dexes.add(d.id);
    }
    await sleep(sleepMs);
  }

  return { found, dexes };
}
