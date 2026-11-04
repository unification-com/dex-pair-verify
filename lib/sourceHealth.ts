// lib/sourceHealth.ts
// Health checks for the live sources' price feeds. A subgraph can break under us (an
// indexing error, indexers dropping it), and so can a Cosmos price API, while go-ooo
// kept querying it and dpv kept advertising its pairs as priceable. Each check probes
// every subgraph source the way `yarn validate-seeds` does (live, still the expected
// schema family, returning priced rows) and every Cosmos source through the price call
// go-ooo makes, retrying a failure before counting it. After UNHEALTHY_AFTER failed
// checks in a row the source is paused: the go-ooo manifest and the priceable flag
// leave it out (HEALTHY_SOURCE_WHERE) until a check passes again. Run by
// `yarn source-health` (cron).

import { Prisma } from "@prisma/client";

import { astroportUsdPrices } from "./astroport";
import prisma from "./prisma";
import { UNHEALTHY_AFTER } from "./sourceHealthState";
import { fetchSqsPrices } from "./sqs";
import { VERIFIED_STATUSES } from "./status";
import { detectProvider, keyEnvVarFor, verifySubgraphSource } from "./subgraphVerify";
import { nowSeconds, sleep } from "./time";

// The sources it's safe to advertise: not paused. (Unchecked and failing-once still count.)
export const HEALTHY_SOURCE_WHERE: Prisma.SupportedSourceWhereInput = { healthFailures: { lt: UNHEALTHY_AFTER } };

// A source as the health check probes it.
export type HealthSource = {
  chain: string;
  dex: string;
  sourceType: string;
  subgraphUrlTemplate: string; // the subgraph URL template, or a Cosmos source's API base URL
  subgraphSchemaFamily: string;
};

// One probe of a source: null when healthy, else why not.
export type HealthProbe = (source: HealthSource) => Promise<string | null>;

export async function probeSubgraphHealth(urlTemplate: string, schemaFamily: string): Promise<string | null> {
  const r = await verifySubgraphSource(urlTemplate);
  if (!r.probe.live) return r.probe.error ?? "not live";
  if (r.probe.schemaFamily !== schemaFamily) return `schema now looks like ${r.probe.schemaFamily}, expected ${schemaFamily}`;
  if (r.dataProbe.applicable && !r.dataProbe.ok) return r.dataProbe.error ?? "no priced rows";
  return null;
}

// Denom -> USD price from a Cosmos source's price API.
export type UsdPrices = (baseUrl: string, chain: string, denoms: string[]) => Promise<Map<string, number>>;

// Each Cosmos transport's USD prices, fetched the way go-ooo's client for it does.
export const COSMOS_USD_PRICES: Record<string, UsdPrices> = {
  "rest-sqs": (baseUrl, _chain, denoms) => fetchSqsPrices(baseUrl, denoms),
  "rest-astroport": (baseUrl, chain, denoms) => astroportUsdPrices(baseUrl, chain, denoms),
};

// A Cosmos source passes when its price API returns a positive USD price for both tokens of its deepest
// verified pair: the call go-ooo prices that source's pairs through (base USD ÷ target USD). With no
// verified pair the source advertises nothing priceable, so there is nothing to check.
export async function probeCosmosHealth(source: HealthSource, usdPrices: UsdPrices): Promise<string | null> {
  const token = { select: { contractAddress: true, symbol: true } };
  const pair = await prisma.pair.findFirst({
    where: { chain: source.chain, dex: source.dex, status: { in: [...VERIFIED_STATUSES] } },
    orderBy: { reserveUsd: "desc" },
    select: { token0: token, token1: token },
  });
  if (!pair) return null;
  const tokens = [pair.token0, pair.token1];
  const prices = await usdPrices(source.subgraphUrlTemplate, source.chain, tokens.map((t) => t.contractAddress));
  const unpriced = tokens.filter((t) => !((prices.get(t.contractAddress) ?? 0) > 0)).map((t) => t.symbol);
  return unpriced.length ? `${unpriced.join(", ")} not priced by ${source.sourceType}` : null;
}

export const probeSourceHealth: HealthProbe = (source) => {
  const usdPrices = COSMOS_USD_PRICES[source.sourceType];
  return usdPrices ? probeCosmosHealth(source, usdPrices) : probeSubgraphHealth(source.subgraphUrlTemplate, source.subgraphSchemaFamily);
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
  const probe = opts.probe ?? probeSourceHealth;
  const attempts = opts.attempts ?? 3;
  const retryGapMs = opts.retryGapMs ?? 20_000;
  const log = opts.log ?? (() => undefined);

  const sources = await prisma.supportedSource.findMany({
    where: { sourceType: { in: ["subgraph", ...Object.keys(COSMOS_USD_PRICES)] } },
    select: { id: true, chain: true, dex: true, sourceType: true, subgraphUrlTemplate: true, subgraphSchemaFamily: true, healthFailures: true },
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
      error = await probe(s);
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
