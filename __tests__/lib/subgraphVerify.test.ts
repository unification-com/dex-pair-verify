// Tests for lib/subgraphVerify.ts — subgraph-source verification (Phase 4, 4.A):
// provider detection, {API_KEY} templating, schema-family classification, and the
// introspection liveness probe (with an injected fetcher).

import { describe, expect, it } from "vitest";

import {
  applyUrlTemplate,
  classifySchemaFamily,
  detectProvider,
  keyEnvVarFor,
  probeSubgraph,
  toUrlTemplate,
  verifySubgraphSource,
  GraphqlFetcher,
} from "../../lib/subgraphVerify";

const DECENTRALIZED = "https://gateway-arbitrum.network.thegraph.com/api/SECRETKEY123/subgraphs/id/EYCKATKGBKLWvSfwvBjzfCBmGwYNdVkduYXVivCsLRFu";
const STUDIO = "https://api.studio.thegraph.com/query/12345/my-subgraph/v0.0.1";
const HOSTED = "https://api.thegraph.com/subgraphs/name/org/subgraph";
const SELF = "https://subgraph.qomswap.com/subgraphs/name/test/exchange";

// Build an introspection-shaped response from a list of query field names.
const introspect = (fields: string[]): GraphqlFetcher => async () =>
  ({ data: { __schema: { queryType: { fields: fields.map((name) => ({ name })) } } } });

describe("detectProvider", () => {
  it("classifies each provider shape", () => {
    expect(detectProvider(DECENTRALIZED)).toBe("graph-decentralized");
    expect(detectProvider(STUDIO)).toBe("graph-studio");
    expect(detectProvider(HOSTED)).toBe("graph-hosted");
    expect(detectProvider(SELF)).toBe("self-hosted");
  });
  it("maps providers to their key env var", () => {
    expect(keyEnvVarFor("graph-decentralized")).toBe("THEGRAPH_API_KEY");
    expect(keyEnvVarFor("graph-studio")).toBe("GRAPH_STUDIO_API_KEY");
    expect(keyEnvVarFor("graph-hosted")).toBeNull();
    expect(keyEnvVarFor("self-hosted")).toBeNull();
  });
});

describe("toUrlTemplate / applyUrlTemplate", () => {
  it("replaces the decentralized-gateway key with a placeholder (never persists the literal)", () => {
    const { template, provider } = toUrlTemplate(DECENTRALIZED);
    expect(provider).toBe("graph-decentralized");
    expect(template).not.toContain("SECRETKEY123");
    expect(template).toContain("{API_KEY}");
    // round-trips back to the literal
    expect(applyUrlTemplate(template, "SECRETKEY123")).toBe(DECENTRALIZED);
  });
  it("passes non-decentralized URLs through unchanged", () => {
    expect(toUrlTemplate(STUDIO).template).toBe(STUDIO);
    expect(toUrlTemplate(SELF).template).toBe(SELF);
  });
});

describe("classifySchemaFamily", () => {
  it("univ2 from a pairs query, univ3 from a pools query", () => {
    expect(classifySchemaFamily(["pair", "pairs", "token"])).toBe("univ2");
    expect(classifySchemaFamily(["pool", "pools", "token"])).toBe("univ3");
  });
  it("custom when ambiguous or neither", () => {
    expect(classifySchemaFamily(["pairs", "pools"])).toBe("custom");
    expect(classifySchemaFamily(["swaps", "tokens"])).toBe("custom");
    expect(classifySchemaFamily([])).toBe("custom");
  });
});

describe("probeSubgraph", () => {
  it("live + univ2 when introspection exposes pairs", async () => {
    const r = await probeSubgraph("http://x", { fetcher: introspect(["pairs", "token"]) });
    expect(r.live).toBe(true);
    expect(r.schemaFamily).toBe("univ2");
    expect(r.queryFields).toContain("pairs");
  });
  it("not live on GraphQL errors", async () => {
    const r = await probeSubgraph("http://x", { fetcher: async () => ({ errors: [{ message: "bad key" }] }) });
    expect(r.live).toBe(false);
    expect(r.error).toContain("bad key");
  });
  it("not live on no response", async () => {
    const r = await probeSubgraph("http://x", { fetcher: async () => null });
    expect(r.live).toBe(false);
  });
});

describe("verifySubgraphSource", () => {
  it("returns a safe template + family from a literal URL", async () => {
    const r = await verifySubgraphSource(DECENTRALIZED, { key: "SECRETKEY123", fetcher: introspect(["pools"]) });
    expect(r.provider).toBe("graph-decentralized");
    expect(r.keyEnvVar).toBe("THEGRAPH_API_KEY");
    expect(r.template).toContain("{API_KEY}");
    expect(r.template).not.toContain("SECRETKEY123");
    expect(r.probe.live).toBe(true);
    expect(r.probe.schemaFamily).toBe("univ3");
  });
});
