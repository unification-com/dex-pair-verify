// import/discover.ts
// Phase 4, 4.A.1 — scan GeckoTerminal for (network, dex) sources we don't yet
// support and write the new ones to CandidateDexNetwork as Pending, for operator
// review at /admin/sources (T6.4). Run with:
//   yarn discover                  # curated EVM scope, target DEX families only
//   yarn discover base optimism    # specific networks, ad hoc
//   yarn discover --all            # every GT dex (the full firehose), not just targets
//
// By default only DEXs matching the 4.D target catalogue are surfaced
// (TARGET_DEX_FAMILIES) — GeckoTerminal lists ~130+ DEXs per chain, almost all
// tiny forks. GeckoTerminal exposes only id+name per dex (Q1); operational fields
// (subgraph template, factory, RPC) are filled when the operator verifies a
// pasted subgraph at promotion. Discovery is idempotent — an existing candidate
// row (any status) is never re-surfaced (D4).

import "../lib/env";

import { fetchGtDexes } from "../lib/gtVerify";
import prisma from "../lib/prisma";
import {
  DISCOVERY_NETWORKS,
  discoveryKey,
  newSourcesForNetwork,
  supportedGtKeys,
} from "../lib/sourceDiscovery";

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const networkArgs = args.filter((a) => a !== "--all");
  const networks = networkArgs.length > 0 ? networkArgs : DISCOVERY_NETWORKS;

  const supported = supportedGtKeys();

  // Every existing candidate (any status) is "known" — Pending (already queued),
  // Enabled (already promoted) or Rejected (operator dismissed, D4). Keyed by the
  // GT (network, dex) slugs, which is what a discovered candidate stores.
  const existing = await prisma.candidateDexNetwork.findMany({ select: { chain: true, dex: true } });
  const knownCandidates = new Set(existing.map((c) => discoveryKey(c.chain, c.dex)));

  console.log(
    `Discovering new sources across ${networks.length} network(s): ${networks.join(", ")} ` +
      `(${all ? "all DEXs" : "target families only"})`,
  );

  let totalNew = 0;
  for (const gtNetwork of networks) {
    console.log(`\nScanning GeckoTerminal dexes for "${gtNetwork}"…`);
    const { found, dexes } = await fetchGtDexes(gtNetwork);
    if (!found) {
      console.log(`  network "${gtNetwork}" not on GeckoTerminal — skipped`);
      continue;
    }

    const fresh = newSourcesForNetwork(gtNetwork, dexes, supported, knownCandidates, { all });
    for (const s of fresh) {
      await prisma.candidateDexNetwork.create({
        data: {
          chain: s.gtNetwork,
          dex: s.gtDex,
          source: "geckoterminal-discovery",
          firstSeen: nowSeconds(),
        },
      });
      knownCandidates.add(discoveryKey(s.gtNetwork, s.gtDex)); // guard within-run dupes
      totalNew += 1;
    }
    console.log(`  ${dexes.size} dex(es) on GT · ${fresh.length} new candidate(s) written`);
  }

  console.log(`\nDiscovery complete — ${totalNew} new candidate(s) across ${networks.length} network(s).`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
