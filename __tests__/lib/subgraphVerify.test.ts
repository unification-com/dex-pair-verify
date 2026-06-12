// Tests for lib/subgraphVerify.ts — subgraph-source verification (Phase 4, 4.A):
// provider detection, {API_KEY} templating, schema-family classification, and the
// introspection liveness probe (with an injected fetcher).

import { describe, expect, it } from "vitest";

import {
  applyUrlTemplate,
  classifySchemaFamily,
  dataProbeSubgraph,
  detectProvider,
  keyEnvVarFor,
  probeSubgraph,
  toUrlTemplate,
  verifySubgraphSource,
  GraphqlFetcher,
} from "../../lib/subgraphVerify";

const DECENTRALIZED = "https://gateway-arbitrum.network.thegraph.com/api/SECRETKEY123/subgraphs/id/EYCKATKGBKLWvSfwvBjzfCBmGwYNdVkduYXVivCsLRFu";
const DECENTRALIZED_MODERN = "https://gateway.thegraph.com/api/SECRETKEY123/subgraphs/id/EYCKATKGBKLWvSfwvBjzfCBmGwYNdVkduYXVivCsLRFu";
const STUDIO = "https://api.studio.thegraph.com/query/12345/my-subgraph/v0.0.1";
const HOSTED = "https://api.thegraph.com/subgraphs/name/org/subgraph";
const SELF = "https://subgraph.qomswap.com/subgraphs/name/test/exchange";

// Build an introspection-shaped response from a list of query field names.
const introspect = (fields: string[]): GraphqlFetcher => async () =>
  ({ data: { __schema: { queryType: { fields: fields.map((name) => ({ name })) } } } });

// Build a data-query response for a collection (e.g. "pairs"/"pools") of rows.
const dataResp = (collection: string, rows: Record<string, unknown>[]): GraphqlFetcher => async () =>
  ({ data: { [collection]: rows } });

// A fetcher that answers both the introspection AND the data query (branches on
// whether the query asks for __schema) — for the end-to-end verifySubgraphSource.
const combined = (fields: string[], collection: string, rows: Record<string, unknown>[]): GraphqlFetcher =>
  async (_url, query) =>
    query.includes("__schema")
      ? { data: { __schema: { queryType: { fields: fields.map((name) => ({ name })) } } } }
      : { data: { [collection]: rows } };

describe("detectProvider", () => {
  it("classifies each provider shape", () => {
    expect(detectProvider(DECENTRALIZED)).toBe("graph-decentralized");
    expect(detectProvider(DECENTRALIZED_MODERN)).toBe("graph-decentralized");
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
  it("templates the modern gateway.thegraph.com host too", () => {
    const { template, provider } = toUrlTemplate(DECENTRALIZED_MODERN);
    expect(provider).toBe("graph-decentralized");
    expect(template).not.toContain("SECRETKEY123");
    expect(template).toContain("{API_KEY}");
    expect(applyUrlTemplate(template, "SECRETKEY123")).toBe(DECENTRALIZED_MODERN);
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
  it("messari from a liquidityPools query (its hallmark entity)", () => {
    expect(classifySchemaFamily(["liquidityPool", "liquidityPools", "dexAmmProtocol"])).toBe("messari");
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

describe("dataProbeSubgraph", () => {
  it("ok when a univ2 pair prices a token (token0Price > 0)", async () => {
    const r = await dataProbeSubgraph("http://x", "univ2", { fetcher: dataResp("pairs", [{ id: "0xp", token0Price: "1500", reserveUSD: "250000" }]) });
    expect(r.applicable).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.sampleReserveUsd).toBe(250000);
    expect(r.sampleId).toBe("0xp");
  });
  it("ok for a BSC subgraph where reserveUSD is 0 but token0Price is set (reserveBNB-tracked)", async () => {
    const r = await dataProbeSubgraph("http://x", "univ2", { fetcher: dataResp("pairs", [{ id: "0xb", token0Price: "0.0000026", reserveUSD: "0" }]) });
    expect(r.ok).toBe(true);
    expect(r.sampleReserveUsd).toBe(0);
  });
  it("ok when a messari pool prices a token (inputTokens[0].lastPriceUSD > 0)", async () => {
    const r = await dataProbeSubgraph("http://x", "messari", { fetcher: dataResp("liquidityPools", [{ id: "0xm", inputTokens: [{ lastPriceUSD: "1638" }], totalValueLockedUSD: "5000" }]) });
    expect(r.applicable).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("ok when a univ3 pool prices a token", async () => {
    const r = await dataProbeSubgraph("http://x", "univ3", { fetcher: dataResp("pools", [{ id: "0xq", token0Price: "0.0005", totalValueLockedUSD: "1234" }]) });
    expect(r.ok).toBe(true);
    expect(r.sampleReserveUsd).toBe(1234);
  });
  it("not ok when the query returns no rows (empty subgraph)", async () => {
    const r = await dataProbeSubgraph("http://x", "univ2", { fetcher: dataResp("pairs", []) });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no rows");
  });
  it("not ok when no sampled pool has a positive token0Price", async () => {
    const r = await dataProbeSubgraph("http://x", "univ3", { fetcher: dataResp("pools", [{ id: "0xz", token0Price: "0", totalValueLockedUSD: "0" }]) });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("token0Price");
  });
  it("not applicable for custom / solidly (no generic query yet)", async () => {
    const r = await dataProbeSubgraph("http://x", "custom");
    expect(r.applicable).toBe(false);
    expect(r.ok).toBe(false);
  });
  it("not ok on GraphQL errors", async () => {
    const r = await dataProbeSubgraph("http://x", "univ2", { fetcher: async () => ({ errors: [{ message: "bad field" }] }) });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("bad field");
  });
});

describe("verifySubgraphSource", () => {
  it("returns a safe template + family + a real-data probe from a literal URL", async () => {
    const r = await verifySubgraphSource(DECENTRALIZED, {
      key: "SECRETKEY123",
      fetcher: combined(["pools"], "pools", [{ id: "0xpool", token0Price: "2000", totalValueLockedUSD: "1000000" }]),
    });
    expect(r.provider).toBe("graph-decentralized");
    expect(r.keyEnvVar).toBe("THEGRAPH_API_KEY");
    expect(r.template).toContain("{API_KEY}");
    expect(r.template).not.toContain("SECRETKEY123");
    expect(r.probe.live).toBe(true);
    expect(r.probe.schemaFamily).toBe("univ3");
    expect(r.dataProbe.ok).toBe(true);
    expect(r.dataProbe.sampleReserveUsd).toBe(1000000);
  });

  it("skips the data probe when introspection is not live", async () => {
    const r = await verifySubgraphSource(DECENTRALIZED, {
      key: "SECRETKEY123",
      fetcher: async () => ({ errors: [{ message: "bad key" }] }),
    });
    expect(r.probe.live).toBe(false);
    expect(r.dataProbe.applicable).toBe(false);
  });
});
