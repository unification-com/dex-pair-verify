// Verify every source's GeckoTerminal (network, dex) slug against GT's live
// dex lists, so a wrong slug is caught before it ingests nothing. Run with:
//   yarn verify-gt

import "../lib/env";

import { fetchGtDexes, NetworkDexes, verifySource } from "../lib/gtVerify";
import { getSources, gtNetworkFor } from "../lib/sourceConfig";

const run = async (): Promise<void> => {
  const sources = await getSources();

  const dexesByNetwork: Record<string, NetworkDexes> = {};
  const distinctNetworks = Array.from(new Set(sources.map((s) => gtNetworkFor(s))));
  for (const net of distinctNetworks) {
    console.log(`Fetching GeckoTerminal dexes for "${net}"…`);
    dexesByNetwork[net] = await fetchGtDexes(net);
    if (!dexesByNetwork[net].found) {
      console.log(`  network "${net}" not on GeckoTerminal`);
    }
  }

  console.log("\n=== Source GeckoTerminal slug verification ===\n");
  let problems = 0;
  for (const s of sources) {
    const v = verifySource(s, dexesByNetwork);
    const status = !v.networkOk
      ? "✗ network not on GeckoTerminal"
      : v.dexOk
        ? "✓ ok"
        : "✗ dex slug NOT found on GeckoTerminal";
    if (!v.dexOk) {
      problems += 1;
    }
    console.log(`${s.chain}/${s.dex}  (GT: ${v.gtNetwork}/${v.gtDex})  ->  ${status}`);
    if (v.networkOk && !v.dexOk && v.candidates.length > 0) {
      console.log(`     candidate GT dex slugs: ${v.candidates.join(", ")}`);
    }
  }

  console.log(`\n${problems === 0 ? "All sources verified ✓" : `${problems} source(s) need a gtNetwork/gtDex fix`}`);
};

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
