// lib/subgraphVerify.ts
// Subgraph-source verification (Phase 4, 4.A — the "ship first" foundation). When
// the operator enables a new (chain, dex) we need to, from a pasted subgraph URL:
//   1. identify the PROVIDER (which env var holds its API key),
//   2. rewrite the URL to a `{API_KEY}` TEMPLATE — the literal key must never be
//      persisted in the DB or emitted in the export manifest (§ 4.A.subgraph-
//      verification security note),
//   3. run a GraphQL introspection LIVENESS probe, and
//   4. auto-classify the SCHEMA FAMILY (univ2 / univ3) that drives the field-map
//      and go-ooo's template-family module (4.B).
//
// Pure helpers + an injectable fetcher so the classification logic is unit-testable
// without a live subgraph. A failed/ambiguous probe never throws — it returns a
// result the candidate-review UI surfaces for operator confirmation.

export type SubgraphProvider = "graph-decentralized" | "graph-studio" | "graph-hosted" | "self-hosted";
export type SchemaFamily = "univ2" | "univ3" | "custom";

// Provider taxonomy: URL pattern + the env var that holds its API key. Order
// matters — most specific first. `self-hosted` is the catch-all (operator-defined
// auth, no managed key).
const PROVIDERS: { provider: SubgraphProvider; test: RegExp; keyEnvVar: string | null }[] = [
  // Matches both the modern gateway host (gateway.thegraph.com) and the older
  // regional one (gateway-arbitrum.network.thegraph.com) that the wired
  // lib/sources.js entries use — the `.network.` segment is optional.
  { provider: "graph-decentralized", test: /^https:\/\/gateway[^/]*\.(network\.)?thegraph\.com\/api\/[^/]+\/subgraphs\/id\/[^/]+/, keyEnvVar: "THEGRAPH_API_KEY" },
  { provider: "graph-studio", test: /^https:\/\/api\.studio\.thegraph\.com\/query\//, keyEnvVar: "GRAPH_STUDIO_API_KEY" },
  { provider: "graph-hosted", test: /^https:\/\/api\.thegraph\.com\/subgraphs\/name\//, keyEnvVar: null },
];

export function detectProvider(url: string): SubgraphProvider {
  for (const p of PROVIDERS) {
    if (p.test.test(url)) {
      return p.provider;
    }
  }
  return "self-hosted";
}

// The env var name a provider's API key comes from (null = no managed key).
export function keyEnvVarFor(provider: SubgraphProvider): string | null {
  return PROVIDERS.find((p) => p.provider === provider)?.keyEnvVar ?? null;
}

// Rewrite a literal decentralized-gateway URL to a `{API_KEY}` template (the key is
// the path segment after `/api/`). Other providers carry no key in the path, so
// they pass through unchanged.
export function toUrlTemplate(url: string): { template: string; provider: SubgraphProvider } {
  const provider = detectProvider(url);
  if (provider === "graph-decentralized") {
    return { template: url.replace(/(\/api\/)[^/]+(\/subgraphs\/id\/)/, "$1{API_KEY}$2"), provider };
  }
  return { template: url, provider };
}

// Substitute a key into a `{API_KEY}` template (idempotent if there's no placeholder).
export function applyUrlTemplate(template: string, key: string): string {
  return template.replace("{API_KEY}", key);
}

// Classify the schema family from the subgraph's top-level query fields. UniV2-like
// exposes a `pairs` query; UniV3-like exposes `pools`. A subgraph exposing only one
// is unambiguous; one exposing both (rare) → custom, so the operator confirms.
export function classifySchemaFamily(queryFieldNames: string[]): SchemaFamily {
  const names = new Set(queryFieldNames.map((n) => n.toLowerCase()));
  const hasPairs = names.has("pairs");
  const hasPools = names.has("pools");
  if (hasPairs && !hasPools) {
    return "univ2";
  }
  if (hasPools && !hasPairs) {
    return "univ3";
  }
  return "custom";
}

const INTROSPECTION_QUERY = `{ __schema { queryType { fields { name } } } }`;

export type GraphqlFetcher = (url: string, query: string) => Promise<unknown>;

const defaultGraphqlFetch: GraphqlFetcher = async (url, query) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

export type ProbeResult = {
  live: boolean;
  schemaFamily: SchemaFamily;
  queryFields: string[];
  error?: string;
};

// Liveness probe + schema-family classification. `url` is the LITERAL URL (key
// already substituted). Injectable fetcher for tests.
export async function probeSubgraph(url: string, opts: { fetcher?: GraphqlFetcher } = {}): Promise<ProbeResult> {
  const fetcher = opts.fetcher ?? defaultGraphqlFetch;
  const json = (await fetcher(url, INTROSPECTION_QUERY)) as
    | { data?: { __schema?: { queryType?: { fields?: { name: string }[] } } }; errors?: { message?: string }[] }
    | null;
  if (!json) {
    return { live: false, schemaFamily: "custom", queryFields: [], error: "no response / non-2xx / timeout" };
  }
  if (json.errors?.length) {
    return { live: false, schemaFamily: "custom", queryFields: [], error: json.errors.map((e) => e.message).join("; ") };
  }
  const fields = json.data?.__schema?.queryType?.fields?.map((f) => f.name) ?? [];
  if (!fields.length) {
    return { live: false, schemaFamily: "custom", queryFields: [], error: "introspection returned no query fields" };
  }
  return { live: true, schemaFamily: classifySchemaFamily(fields), queryFields: fields };
}

// Minimal "is this subgraph returning real, usable pricing data" query per schema
// family. univ2 fetches a pair with positive reserveUSD; univ3 (incl. Algebra,
// which exposes the same pools/TVL fields) a pool with positive
// totalValueLockedUSD. A `where` filter rather than an orderBy — a global sort is
// slow on large subgraphs (times out) and surfaces univ2's notoriously corrupted
// reserveUSD outliers. custom/solidly have no generic query (they await a dedicated
// template), so the data probe is not applicable. Reserve values are BigDecimal, so
// the threshold is a quoted string.
const DATA_QUERY: Partial<Record<SchemaFamily, { query: string; collection: string; reserveField: string }>> = {
  univ2: {
    query: `{ pairs(first: 1, where: { reserveUSD_gt: "0" }) { id reserveUSD } }`,
    collection: "pairs",
    reserveField: "reserveUSD",
  },
  univ3: {
    query: `{ pools(first: 1, where: { totalValueLockedUSD_gt: "0" }) { id totalValueLockedUSD } }`,
    collection: "pools",
    reserveField: "totalValueLockedUSD",
  },
};

export type DataProbeResult = {
  applicable: boolean; // false for custom/solidly (no generic query yet)
  ok: boolean; // true when the query returned a row with a positive reserve/TVL
  rowCount: number;
  sampleReserveUsd: number | null;
  sampleId: string | null;
  error?: string;
};

// Real-data liveness/usability probe: runs the schema family's minimal query (the
// same one the pipeline uses) and checks a row comes back with a positive
// reserve/TVL. Stronger than introspection — catches subgraphs that exist but are
// empty, broken, re-synced, or a schema variant. Injectable fetcher for tests.
export async function dataProbeSubgraph(
  url: string,
  schemaFamily: SchemaFamily,
  opts: { fetcher?: GraphqlFetcher } = {},
): Promise<DataProbeResult> {
  const spec = DATA_QUERY[schemaFamily];
  if (!spec) {
    return { applicable: false, ok: false, rowCount: 0, sampleReserveUsd: null, sampleId: null, error: `no generic data query for schema family "${schemaFamily}"` };
  }
  const fetcher = opts.fetcher ?? defaultGraphqlFetch;
  const json = (await fetcher(url, spec.query)) as
    | { data?: Record<string, { id: string; [k: string]: unknown }[]>; errors?: { message?: string }[] }
    | null;
  if (!json) {
    return { applicable: true, ok: false, rowCount: 0, sampleReserveUsd: null, sampleId: null, error: "no response / non-2xx / timeout" };
  }
  if (json.errors?.length) {
    return { applicable: true, ok: false, rowCount: 0, sampleReserveUsd: null, sampleId: null, error: json.errors.map((e) => e.message).join("; ") };
  }
  const rows = json.data?.[spec.collection] ?? [];
  if (rows.length === 0) {
    return { applicable: true, ok: false, rowCount: 0, sampleReserveUsd: null, sampleId: null, error: "query returned no rows (empty subgraph?)" };
  }
  const top = rows[0];
  const reserve = parseFloat(String(top[spec.reserveField] ?? ""));
  const reserveOk = Number.isFinite(reserve) && reserve > 0;
  return {
    applicable: true,
    ok: reserveOk,
    rowCount: rows.length,
    sampleReserveUsd: Number.isFinite(reserve) ? reserve : null,
    sampleId: top.id ?? null,
    error: reserveOk ? undefined : "top row has no positive reserve/TVL",
  };
}

const skippedDataProbe = (error: string): DataProbeResult => ({
  applicable: false,
  ok: false,
  rowCount: 0,
  sampleReserveUsd: null,
  sampleId: null,
  error,
});

export type VerifyResult = {
  provider: SubgraphProvider;
  template: string;      // {API_KEY} placeholder, safe to persist / export
  keyEnvVar: string | null;
  probe: ProbeResult;
  dataProbe: DataProbeResult;
};

// Operator-paste entry point: detect provider, build the safe template, run the
// introspection probe (classify the schema family), then — if it's live — the
// real-data probe (confirm the subgraph actually returns usable pricing rows,
// like go-ooo would). The returned `template` is what gets persisted — never the
// literal URL. Key taken from env by default; pass `key` in tests.
export async function verifySubgraphSource(
  literalUrl: string,
  opts: { key?: string; fetcher?: GraphqlFetcher } = {},
): Promise<VerifyResult> {
  const { template, provider } = toUrlTemplate(literalUrl);
  const keyEnvVar = keyEnvVarFor(provider);
  const key = opts.key ?? (keyEnvVar ? process.env[keyEnvVar] ?? "" : "");
  const literal = applyUrlTemplate(template, key);
  const probe = await probeSubgraph(literal, { fetcher: opts.fetcher });
  const dataProbe = probe.live
    ? await dataProbeSubgraph(literal, probe.schemaFamily, { fetcher: opts.fetcher })
    : skippedDataProbe("skipped — introspection not live");
  return { provider, template, keyEnvVar, probe, dataProbe };
}
