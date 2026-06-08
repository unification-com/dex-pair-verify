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

// SSRF guard for operator-pasted subgraph URLs. The verify path fetches whatever
// URL the operator submits, so a self-hosted entry could otherwise point the
// server at internal services (cloud metadata at 169.254.169.254, localhost admin
// ports, RFC-1918 ranges). Require https and reject loopback / link-local /
// private hosts. Hostname-based (no DNS resolution) — proportionate for an
// operator-gated, defence-in-depth control.
export class UnsafeSubgraphUrlError extends Error {}

const isPrivateIpv4 = (host: string): boolean => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) {
    return false;
  }
  const a = Number(m[1]);
  const b = Number(m[2]);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||           // link-local (cloud metadata)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224                              // multicast / reserved
  );
};

const isPrivateHost = (host: string): boolean => {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase(); // strip IPv6 brackets
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) {
    return true;
  }
  if (h.includes(":")) {
    // IPv6 literal — loopback / unspecified / unique-local (fc00::/7) / link-local /
    // IPv4-mapped. The ":" guard keeps these off ordinary hostnames (e.g. "fc…com").
    return h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:");
  }
  return isPrivateIpv4(h);
};

export function assertSafeSubgraphUrl(rawUrl: string): void {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new UnsafeSubgraphUrlError("subgraph URL is not a valid URL");
  }
  if (u.protocol !== "https:") {
    throw new UnsafeSubgraphUrlError("subgraph URL must use https");
  }
  if (isPrivateHost(u.hostname)) {
    throw new UnsafeSubgraphUrlError("subgraph URL host is not allowed (private/loopback/link-local)");
  }
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
    // Network-boundary backstop: never let a real fetch reach a private/non-https
    // host, whatever the caller. (Tests inject a fetcher and bypass this path.)
    assertSafeSubgraphUrl(url);
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

// Minimal "is this subgraph returning usable pricing data" query per schema family.
// We sample a handful of pairs/pools and require at least one with a positive
// token0Price — the field go-ooo actually prices from, and the only one populated
// across ALL chains. (BSC univ2 forks like PancakeSwap leave reserveUSD at 0 and
// track reserveBNB instead, so a reserveUSD check false-negatives them.) reserveUSD
// / TVL is read too, purely as a liquidity sample for display (0 on those BSC
// subgraphs). No orderBy — a global sort is slow on big subgraphs and unnecessary
// for a liveness check. custom/solidly have no generic query (they await a
// dedicated template), so the data probe is not applicable.
const DATA_QUERY: Partial<Record<SchemaFamily, { query: string; collection: string; priceField: string; reserveField: string }>> = {
  univ2: {
    query: `{ pairs(first: 5) { id token0Price reserveUSD } }`,
    collection: "pairs",
    priceField: "token0Price",
    reserveField: "reserveUSD",
  },
  univ3: {
    query: `{ pools(first: 5) { id token0Price totalValueLockedUSD } }`,
    collection: "pools",
    priceField: "token0Price",
    reserveField: "totalValueLockedUSD",
  },
};

// One sampled pair/pool row, surfaced so the operator can eyeball real data
// before promoting (id + the priced token0Price + the reserve/TVL field).
export type DataSample = { id: string; price: number | null; reserve: number | null };

export type DataProbeResult = {
  applicable: boolean; // false for custom/solidly (no generic query yet)
  ok: boolean; // true when a sampled pool/pair prices a token (token0Price > 0)
  rowCount: number;
  sampleReserveUsd: number | null; // a liquidity sample for display (0 on BSC subgraphs)
  sampleId: string | null;
  samples: DataSample[]; // the sampled rows (id + price + reserve) for display
  error?: string;
};

// Empty result shared by every short-circuit return below (DRY).
const emptyData = (applicable: boolean, error: string): DataProbeResult => ({
  applicable,
  ok: false,
  rowCount: 0,
  sampleReserveUsd: null,
  sampleId: null,
  samples: [],
  error,
});

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
    return emptyData(false, `no generic data query for schema family "${schemaFamily}"`);
  }
  const fetcher = opts.fetcher ?? defaultGraphqlFetch;
  const json = (await fetcher(url, spec.query)) as
    | { data?: Record<string, { id: string; [k: string]: unknown }[]>; errors?: { message?: string }[] }
    | null;
  if (!json) {
    return emptyData(true, "no response / non-2xx / timeout");
  }
  if (json.errors?.length) {
    return emptyData(true, json.errors.map((e) => e.message).join("; "));
  }
  const rows = json.data?.[spec.collection] ?? [];
  if (rows.length === 0) {
    return emptyData(true, "query returned no rows (empty subgraph?)");
  }
  // Per-row sample (id + priced token0Price + reserve/TVL), surfaced for display.
  const samples: DataSample[] = rows.map((r) => {
    const p = parseFloat(String(r[spec.priceField] ?? ""));
    const rv = parseFloat(String(r[spec.reserveField] ?? ""));
    return { id: r.id, price: Number.isFinite(p) ? p : null, reserve: Number.isFinite(rv) ? rv : null };
  });
  // Usable = at least one sampled pool prices a token (token0Price > 0). reserveUSD
  // is only a display sample (0 on BSC subgraphs that track reserveBNB instead).
  const priced = samples.filter((s) => s.price != null && s.price > 0);
  const reserves = samples.map((s) => s.reserve).filter((n): n is number => n != null);
  const ok = priced.length > 0;
  return {
    applicable: true,
    ok,
    rowCount: rows.length,
    sampleReserveUsd: reserves.length ? Math.max(...reserves) : null,
    sampleId: (priced[0] ?? samples[0]).id ?? null,
    samples,
    error: ok ? undefined : "no sampled pool has a positive token0Price",
  };
}

const skippedDataProbe = (error: string): DataProbeResult => emptyData(false, error);

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
