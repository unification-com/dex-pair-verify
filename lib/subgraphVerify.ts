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
  { provider: "graph-decentralized", test: /^https:\/\/gateway[^/]*\.network\.thegraph\.com\/api\/[^/]+\/subgraphs\/id\/[^/]+/, keyEnvVar: "THEGRAPH_API_KEY" },
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

export type VerifyResult = {
  provider: SubgraphProvider;
  template: string;      // {API_KEY} placeholder, safe to persist / export
  keyEnvVar: string | null;
  probe: ProbeResult;
};

// Operator-paste entry point: detect provider, build the safe template, then probe
// using the substituted literal key (taken from env by default; pass `key` in tests).
// The returned `template` is what gets persisted — never the literal URL.
export async function verifySubgraphSource(
  literalUrl: string,
  opts: { key?: string; fetcher?: GraphqlFetcher } = {},
): Promise<VerifyResult> {
  const { template, provider } = toUrlTemplate(literalUrl);
  const keyEnvVar = keyEnvVarFor(provider);
  const key = opts.key ?? (keyEnvVar ? process.env[keyEnvVar] ?? "" : "");
  const probe = await probeSubgraph(applyUrlTemplate(template, key), { fetcher: opts.fetcher });
  return { provider, template, keyEnvVar, probe };
}
