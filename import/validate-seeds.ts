// import/validate-seeds.ts
// Validate every entry in lib/sourceSeeds.ts against its LIVE subgraph (Phase 4,
// 4.A): run GraphQL introspection + a real top-pool query (the same shape the
// pipeline / go-ooo run) and confirm the schema family matches and real data comes
// back. Evidence-first — an ID only earns its place in the seed once it passes
// here. Run with:
//   yarn validate-seeds
// Uses THEGRAPH_API_KEY for the decentralised-network endpoints. Each seed costs
// ~2 billable queries (introspection + data), so a full run is ~2× the seed count.

import "../lib/env";

import { decentralizedTemplate, SOURCE_SEEDS } from "../lib/sourceSeeds";
import { verifySubgraphSource } from "../lib/subgraphVerify";

const usd = (n: number | null): string => (n == null ? "?" : `$${Math.round(n).toLocaleString("en-GB")}`);

const main = async (): Promise<void> => {
  if (!process.env.THEGRAPH_API_KEY) {
    console.error("THEGRAPH_API_KEY is not set — decentralised-network probes will fail. Set it in .env.");
  }
  console.log(`Validating ${SOURCE_SEEDS.length} seed(s) against live subgraphs (~${SOURCE_SEEDS.length * 2} queries)…\n`);

  let pass = 0;
  const problems: string[] = [];
  for (const s of SOURCE_SEEDS) {
    const r = await verifySubgraphSource(decentralizedTemplate(s.subgraphId));
    const familyOk = r.probe.schemaFamily === s.schemaFamily;
    // Solidly/custom seeds have no generic data query — judge them on liveness only.
    const dataOk = r.dataProbe.applicable ? r.dataProbe.ok : null;
    const ok = r.probe.live && familyOk && dataOk !== false;
    if (ok) {
      pass += 1;
    } else {
      problems.push(`${s.chain}/${s.dex}`);
    }

    const bits = [
      `${ok ? "✓" : "✗"} ${s.chain}/${s.dex}`,
      `live=${r.probe.live}`,
      `family=${r.probe.schemaFamily}${familyOk ? "" : `(want ${s.schemaFamily})`}`,
      r.dataProbe.applicable ? `data=${r.dataProbe.ok} reserve~${usd(r.dataProbe.sampleReserveUsd)}` : "data=n/a",
    ];
    const err = !r.probe.live ? r.probe.error : r.dataProbe.applicable && !r.dataProbe.ok ? r.dataProbe.error : undefined;
    if (err) {
      bits.push(`err="${err}"`);
    }
    console.log(bits.join("  "));
  }

  console.log(`\n${pass}/${SOURCE_SEEDS.length} seeds validated ✓`);
  if (problems.length) {
    console.log(`Need attention: ${problems.join(", ")}`);
  }
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
