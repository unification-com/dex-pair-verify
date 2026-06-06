// Tests for the synchronous, code-backed parts of lib/sourceConfig.ts +
// lib/baselineSources.ts. The DB-backed accessors (getSources / getSource /
// getCanonicalFactoryAddress) are exercised by the integration suite, since they
// read SupportedSource; here we cover the bootstrap registry and threshold seeding.

import { describe, expect, it } from "vitest";

import { BASELINE_SOURCES } from "../../lib/baselineSources";
import { thresholdSeedData } from "../../lib/sourceConfig";

describe("BASELINE_SOURCES (the code bootstrap that re-seeds a wiped DB)", () => {
  it("carries the original production sources with their factories", () => {
    const byKey = new Map(BASELINE_SOURCES.map((s) => [`${s.chain}/${s.dex}`, s]));
    expect(byKey.get("eth/uniswap_v3")?.factoryAddress).toBe("0x1F98431c8aD98523631AE4a59f267346ea31F984");
    expect(byKey.get("bsc/bsc_pancakeswap_v3")?.factoryAddress).toBe("0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865");
    expect(byKey.get("bsc/bsc_pancakeswap_v3")?.gtDex).toBe("pancakeswap-v3-bsc");
  });

  it("templates every decentralised URL with {API_KEY} — never a literal key", () => {
    for (const s of BASELINE_SOURCES) {
      if (s.subgraphProvider === "graph-decentralized") {
        expect(s.subgraphUrlTemplate).toContain("{API_KEY}");
      }
    }
  });
});

describe("thresholdSeedData", () => {
  it("applies a source's A.8 matrix floors (deep venue)", () => {
    const seed = thresholdSeedData("bsc", "bsc_pancakeswap_v3");
    expect(seed).toMatchObject({
      chain: "bsc",
      dex: "bsc_pancakeswap_v3",
      minLiquidityUsd: 35000,
      hardMinLiquidityUsd: 5000,
      minTxCount: 5,
    });
  });

  it("applies the thin-venue floors", () => {
    const seed = thresholdSeedData("xdai", "honeyswap");
    expect(seed.minLiquidityUsd).toBe(5000);
    expect(seed.hardMinLiquidityUsd).toBe(2000);
  });

  it("falls back to a bare-zero seed for an unknown source", () => {
    const seed = thresholdSeedData("eth", "not-a-dex");
    expect(seed).toEqual({ chain: "eth", dex: "not-a-dex", minLiquidityUsd: 0, minTxCount: 0 });
  });
});
