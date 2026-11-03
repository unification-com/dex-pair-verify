// Integration tests for lib/sourceHealth.ts: recording subgraph health, and paused sources leaving
// the go-ooo manifest and the priceable flag.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetDb, seedSource, testPrisma } from "./helpers";
import { buildExportManifestV3, priceableSourceMeta } from "../../lib/export";
import { checkSourceHealth, HealthProbe } from "../../lib/sourceHealth";

const NOW = 1_700_000_000;
const passing: HealthProbe = async () => null;
// Fails only the given source URLs.
const failingFor = (...urls: string[]): HealthProbe => async (url) => (urls.includes(url) ? "bad indexers" : null);
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
    const flaky: HealthProbe = async (url) => (url === sources[0].subgraphUrlTemplate && ++calls === 1 ? "timeout" : null);
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

  it("leaves non-subgraph sources alone", async () => {
    const sqs = await seedSource({ chain: "osmosis", dex: "osmosis_sqs", sourceType: "rest-sqs", subgraphUrlTemplate: "https://sqs.test" });
    const probe = vi.fn(passing);
    await checkSourceHealth({ now: NOW, probe, retryGapMs: 0 });
    expect(probe).toHaveBeenCalledTimes(3);
    expect((await row(sqs.id)).healthCheckedAt).toBe(0);
  });

  it("refuses to run when a gateway source's API key is missing", async () => {
    vi.stubEnv("THEGRAPH_API_KEY", "");
    await seedSource({ chain: "base", subgraphUrlTemplate: "https://gateway-arbitrum.network.thegraph.com/api/{API_KEY}/subgraphs/id/X" });
    await expect(check(passing)).rejects.toThrow(/THEGRAPH_API_KEY is not set/);
    expect((await row(sources[0].id)).healthCheckedAt).toBe(0);
  });
});
