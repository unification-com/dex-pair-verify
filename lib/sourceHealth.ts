// lib/sourceHealth.ts
// Subgraph health checks for the live sources. A subgraph can break under us (an
// indexing error, indexers dropping it), and go-ooo would keep querying it while
// dpv kept advertising its pairs as priceable. Each check probes every subgraph
// source the way `yarn validate-seeds` does (live, still the expected schema
// family, returning priced rows), retrying a failure before counting it. After
// UNHEALTHY_AFTER failed checks in a row the source is paused: the go-ooo
// manifest and the priceable flag leave it out (HEALTHY_SOURCE_WHERE) until a
// check passes again. Run by `yarn source-health` (cron).

import { Prisma } from "@prisma/client";

import prisma from "./prisma";
import { UNHEALTHY_AFTER } from "./sourceHealthState";
import { detectProvider, keyEnvVarFor, verifySubgraphSource } from "./subgraphVerify";
import { nowSeconds, sleep } from "./time";

// The sources it's safe to advertise: not paused. (Unchecked and failing-once still count.)
export const HEALTHY_SOURCE_WHERE: Prisma.SupportedSourceWhereInput = { healthFailures: { lt: UNHEALTHY_AFTER } };

// One probe of a source: null when healthy, else why not.
export type HealthProbe = (urlTemplate: string, schemaFamily: string) => Promise<string | null>;

export const probeSubgraphHealth: HealthProbe = async (urlTemplate, schemaFamily) => {
  const r = await verifySubgraphSource(urlTemplate);
  if (!r.probe.live) return r.probe.error ?? "not live";
  if (r.probe.schemaFamily !== schemaFamily) return `schema now looks like ${r.probe.schemaFamily}, expected ${schemaFamily}`;
  if (r.dataProbe.applicable && !r.dataProbe.ok) return r.dataProbe.error ?? "no priced rows";
  return null;
};

// More than this share of sources failing in one check points at our side (network, gateway, key),
// not at the subgraphs, so nothing is recorded rather than pausing everything.
const SYSTEMIC_FAILURE_SHARE = 0.5;

export type HealthCheckSummary = {
  checked: number;
  failing: string[]; // failed this check
  paused: string[]; // at or past UNHEALTHY_AFTER after this check
  recorded: boolean; // false when the check was judged systemic and not recorded
};

export async function checkSourceHealth(
  opts: { now?: number; probe?: HealthProbe; attempts?: number; retryGapMs?: number; log?: (msg: string) => void } = {},
): Promise<HealthCheckSummary> {
  const now = opts.now ?? nowSeconds();
  const probe = opts.probe ?? probeSubgraphHealth;
  const attempts = opts.attempts ?? 3;
  const retryGapMs = opts.retryGapMs ?? 20_000;
  const log = opts.log ?? (() => undefined);

  const sources = await prisma.supportedSource.findMany({
    where: { sourceType: "subgraph" },
    select: { id: true, chain: true, dex: true, subgraphUrlTemplate: true, subgraphSchemaFamily: true, healthFailures: true },
    orderBy: [{ chain: "asc" }, { dex: "asc" }],
  });

  // A missing gateway key would fail every keyed source: a configuration problem, not an outage.
  for (const s of sources) {
    const keyVar = keyEnvVarFor(detectProvider(s.subgraphUrlTemplate));
    if (keyVar && !process.env[keyVar]) {
      throw new Error(`${keyVar} is not set; refusing to record health for ${s.chain}/${s.dex} and the rest`);
    }
  }

  const results: { id: string; key: string; prevFailures: number; failures: number; error: string | null }[] = [];
  for (const s of sources) {
    let error: string | null = null;
    for (let i = 0; i < attempts; i++) {
      error = await probe(s.subgraphUrlTemplate, s.subgraphSchemaFamily);
      if (!error) break;
      if (i < attempts - 1) await sleep(retryGapMs);
    }
    const key = `${s.chain}/${s.dex}`;
    log(`${error ? "✗" : "✓"} ${key}${error ? `  ${error.slice(0, 160)}` : ""}`);
    results.push({ id: s.id, key, prevFailures: s.healthFailures, failures: error ? s.healthFailures + 1 : 0, error });
  }

  const failing = results.filter((r) => r.error);
  // Paused as the DB stands afterwards: the new counts if recorded, the previous ones if not.
  const summary = (recorded: boolean): HealthCheckSummary => ({
    checked: results.length,
    failing: failing.map((r) => r.key),
    paused: results.filter((r) => (recorded ? r.failures : r.prevFailures) >= UNHEALTHY_AFTER).map((r) => r.key),
    recorded,
  });
  if (results.length > 0 && failing.length / results.length > SYSTEMIC_FAILURE_SHARE) {
    log(`${failing.length}/${results.length} sources failed: looks systemic, not recording`);
    return summary(false);
  }

  for (const r of results) {
    await prisma.supportedSource.update({
      where: { id: r.id },
      data: r.error
        ? { healthCheckedAt: now, healthFailures: r.failures, healthError: r.error.slice(0, 500) }
        : { healthCheckedAt: now, healthFailures: 0, healthError: "", lastVerifiedAt: now },
    });
  }
  return summary(true);
}
