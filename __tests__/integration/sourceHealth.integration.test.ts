// Integration tests for lib/sourceHealth.ts: recording price-feed health (subgraph and Cosmos sources),
// and paused sources leaving the go-ooo manifest and the priceable flag.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetDb, seedPair, seedSource, seedToken, testPrisma } from "./helpers";
import { buildExportManifestV3, GOOOO_PRICEABLE_COSMOS_SOURCE_TYPES, priceableSourceMeta } from "../../lib/export";
import { checkSourceHealth, COSMOS_USD_PRICES, HealthProbe, HealthSource, probeCosmosHealth, UsdPrices } from "../../lib/sourceHealth";
import { TokenPairStatus } from "../../types/types";

const NOW = 1_700_000_000;
const passing: HealthProbe = async () => null;
// Fails only the given source URLs.
const failingFor = (...urls: string[]): HealthProbe => async (s) => (urls.includes(s.subgraphUrlTemplate) ? "bad indexers" : null);
const check = (probe: HealthProbe, now = NOW) => checkSourceHealth({ now, probe, retryGapMs: 0 });
const row = (id: string) => testPrisma.supportedSource.findUniqueOrThrow({ where: { id } });
const manifestKeys = async () => (await buildExportManifestV3({ now: NOW })).supportedSources.map((s) => `${s.chain}/${s.dex}`);

let sources: { id: string; subgraphUrlTemplate: string }[] = [];
beforeEach(async () => {
  await resetDb();
  sources = [];
  for (const dex of ["uniswap_v3", "sushiswap", "pancakeswap_v3"]) {
    sources.push(await seedSource({ dex, subgraphUrlTemplate: `https://example.test/${dex}` }));
  }
});

afterEach(() => vi.unstubAllEnvs());

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("checkSourceHealth", () => {
  it("stamps a passing source healthy and verified", async () => {
    const s = await check(passing);
    expect(s).toMatchObject({ checked: 3, failing: [], paused: [], recorded: true });
    expect(await row(sources[0].id)).toMatchObject({ healthCheckedAt: NOW, healthFailures: 0, healthError: "", lastVerifiedAt: NOW });
  });

  it("pauses a source after two failed checks in a row, out of the manifest and the priceable flag", async () => {
    const broken = sources[0];
    const probe = failingFor(broken.subgraphUrlTemplate);

    await check(probe);
    expect(await row(broken.id)).toMatchObject({ healthFailures: 1, healthError: "bad indexers" });
    expect(await manifestKeys()).toContain("eth/uniswap_v3"); // one failure: still advertised

    const s = await check(probe, NOW + 3600);
    expect(s.paused).toEqual(["eth/uniswap_v3"]);
    expect(await manifestKeys()).not.toContain("eth/uniswap_v3");
    expect((await priceableSourceMeta()).has("eth/uniswap_v3")).toBe(false);
    expect((await priceableSourceMeta()).has("eth/sushiswap")).toBe(true);

    // One passing check brings it straight back.
    await check(passing, NOW + 7200);
    expect(await row(broken.id)).toMatchObject({ healthFailures: 0, healthError: "", lastVerifiedAt: NOW + 7200 });
    expect(await manifestKeys()).toContain("eth/uniswap_v3");
  });

  it("retries a failed probe before counting it", async () => {
    let calls = 0;
    const flaky: HealthProbe = async (s) => (s.subgraphUrlTemplate === sources[0].subgraphUrlTemplate && ++calls === 1 ? "timeout" : null);
    await check(flaky);
    expect(calls).toBe(2);
    expect((await row(sources[0].id)).healthFailures).toBe(0);
  });

  it("records nothing when most sources fail at once", async () => {
    const s = await check(failingFor(sources[0].subgraphUrlTemplate, sources[1].subgraphUrlTemplate));
    expect(s.recorded).toBe(false);
    expect(s.failing).toHaveLength(2);
    expect((await row(sources[0].id)).healthCheckedAt).toBe(0);
  });

  it("probes the Cosmos sources too, and leaves a source type it can't probe alone", async () => {
    const sqs = await seedSource({ chain: "osmosis", dex: "osmosis_sqs", sourceType: "rest-sqs", subgraphUrlTemplate: "https://sqs.test" });
    const other = await seedSource({ chain: "solana", dex: "raydium", sourceType: "rest-unknown", subgraphUrlTemplate: "https://x.test" });
    const probe = vi.fn(passing);
    await checkSourceHealth({ now: NOW, probe, retryGapMs: 0 });
    expect(probe).toHaveBeenCalledTimes(4);
    expect((await row(sqs.id)).healthCheckedAt).toBe(NOW);
    expect((await row(other.id)).healthCheckedAt).toBe(0);
  });

  it("has a Cosmos probe for every Cosmos transport go-ooo prices", () => {
    expect(Object.keys(COSMOS_USD_PRICES).sort()).toEqual(Array.from(GOOOO_PRICEABLE_COSMOS_SOURCE_TYPES).sort());
  });

  it("refuses to run when a gateway source's API key is missing", async () => {
    vi.stubEnv("THEGRAPH_API_KEY", "");
    await seedSource({ chain: "base", subgraphUrlTemplate: "https://gateway-arbitrum.network.thegraph.com/api/{API_KEY}/subgraphs/id/X" });
    await expect(check(passing)).rejects.toThrow(/THEGRAPH_API_KEY is not set/);
    expect((await row(sources[0].id)).healthCheckedAt).toBe(0);
  });
});

describe("probeCosmosHealth", () => {
  const OSMOSIS: HealthSource = { chain: "osmosis", dex: "osmosis_sqs", sourceType: "rest-sqs", subgraphUrlTemplate: "https://sqs.test", subgraphSchemaFamily: "custom" };
  const pricing = (table: Record<string, number>): UsdPrices => async (_url, _chain, denoms) =>
    new Map(denoms.filter((d) => d in table).map((d) => [d, table[d]]));

  beforeEach(async () => {
    const token = (contractAddress: string, symbol: string) => seedToken({ chain: "osmosis", contractAddress, symbol });
    const [osmo, usdc, atom, junk] = [await token("uosmo", "OSMO"), await token("ibc/USDC", "USDC"), await token("ibc/ATOM", "ATOM"), await token("ibc/JUNK", "JUNK")];
    const pair = (t0: string, t1: string, reserveUsd: number, status: TokenPairStatus) =>
      seedPair(t0, t1, { chain: "osmosis", dex: "osmosis_sqs", reserveUsd, status });
    await pair(osmo.id, usdc.id, 2_000_000, TokenPairStatus.AutoVerified);
    await pair(atom.id, usdc.id, 500_000, TokenPairStatus.ManualVerified);
    await pair(junk.id, usdc.id, 9_000_000, TokenPairStatus.AutoRejected); // deeper, but not verified
  });

  it("prices the tokens of the deepest verified pairs in one call, and passes when one pair is fully priced", async () => {
    let asked: string[] = [];
    const prices: UsdPrices = async (url, chain, denoms) => {
      asked = denoms;
      return pricing({ uosmo: 0.047, "ibc/USDC": 1 })(url, chain, denoms);
    };
    expect(await probeCosmosHealth(OSMOSIS, prices)).toBeNull();
    expect(asked).toEqual(["uosmo", "ibc/USDC", "ibc/ATOM"]);
  });

  it("passes when one token has lost its price but another verified pair still prices", async () => {
    expect(await probeCosmosHealth(OSMOSIS, pricing({ "ibc/USDC": 1, "ibc/ATOM": 1.97 }))).toBeNull();
  });

  it("fails naming the unpriced tokens when no verified pair prices", async () => {
    expect(await probeCosmosHealth(OSMOSIS, pricing({ "ibc/USDC": 1 }))).toBe("no verified pair priced by rest-sqs (unpriced: OSMO, ATOM)");
    expect(await probeCosmosHealth(OSMOSIS, pricing({}))).toBe("no verified pair priced by rest-sqs (unpriced: OSMO, USDC, ATOM)");
  });

  it("passes a source with no verified pair: it advertises nothing to price", async () => {
    expect(await probeCosmosHealth({ ...OSMOSIS, dex: "other" }, pricing({}))).toBeNull();
  });
});
