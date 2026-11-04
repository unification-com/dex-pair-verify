// Integration tests for runFactoryCheckForPair + pairsToFactoryCheck (T2). The
// RPC eth_call is injected; asserts the factory is persisted and the verdict
// re-run reflects a match (raises confidence) vs a mismatch (→ Needs Review).

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, seedPair, seedToken, testPrisma } from "./helpers";
import { pairsToFactoryCheck, runFactoryCheckForPair } from "../../lib/factoryCheck";
import { TokenPairStatus } from "../../types/types";

const NOW = 1_700_000_000;
const UNI_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984"; // canonical for eth/uniswap_v3
const OTHER = "0x000000000000000000000000000000000000FaC7";

// The 32-byte ABI word an eth_call to factory() returns for an address.
const word = (addr: string) => `0x${"0".repeat(24)}${addr.slice(2).toLowerCase()}`;

// A pair whose tokens are CG-listed so it is otherwise auto-verifiable.
async function seedCleanPair(over = {}) {
  const t0 = await seedToken({ coingeckoCoinId: "weth" });
  const t1 = await seedToken({ coingeckoCoinId: "usd-coin", decimals: 6 });
  return seedPair(t0.id, t1.id, { status: TokenPairStatus.NeedsReview, ...over });
}

beforeEach(async () => {
  await resetDb();
  // The canonical factory now comes from the SupportedSource registry (T6.5), so
  // seed the eth/uniswap_v3 source the factory fence checks against.
  await testPrisma.supportedSource.create({
    data: {
      chain: "eth",
      dex: "uniswap_v3",
      subgraphUrlTemplate: "https://gateway.thegraph.com/api/{API_KEY}/subgraphs/id/ABC",
      subgraphSchemaFamily: "univ3",
      subgraphProvider: "graph-decentralized",
      factoryAddress: UNI_V3_FACTORY,
      lastVerifiedAt: 0,
      enabledAt: 0,
    },
  });
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("runFactoryCheckForPair", () => {
  it("persists a matching factory and the pair auto-verifies", async () => {
    const pair = await seedCleanPair();
    const out = await runFactoryCheckForPair(pair.id, { now: NOW, ethCall: async () => word(UNI_V3_FACTORY) });

    expect(out.factoryFound).toBe(true);
    expect(out.mismatch).toBe(false);
    expect(out.verdict).toBe(TokenPairStatus.AutoVerified);

    const row = await testPrisma.pair.findUnique({ where: { id: pair.id } });
    expect(row?.factoryAddress).toBe(UNI_V3_FACTORY);
    expect(row?.factoryCheckedAt).toBe(NOW);
    expect(row?.status).toBe(TokenPairStatus.AutoVerified);
  });

  it("routes a factory mismatch to Needs Review", async () => {
    const pair = await seedCleanPair();
    const out = await runFactoryCheckForPair(pair.id, { now: NOW, ethCall: async () => word(OTHER) });

    expect(out.mismatch).toBe(true);
    expect(out.verdict).toBe(TokenPairStatus.NeedsReview);
    expect((await testPrisma.pair.findUnique({ where: { id: pair.id } }))?.factoryAddress).toBe(OTHER);
  });

  it("stamps the attempt but leaves the verdict alone on an RPC miss", async () => {
    const pair = await seedCleanPair();
    const out = await runFactoryCheckForPair(pair.id, { now: NOW, ethCall: async () => null });

    expect(out.checked).toBe(true);
    expect(out.factoryFound).toBe(false);
    expect(out.verdict).toBeNull(); // no re-run when nothing was learned
    const row = await testPrisma.pair.findUnique({ where: { id: pair.id } });
    expect(row?.factoryAddress).toBeNull();
    expect(row?.factoryCheckedAt).toBe(NOW);
  });

  it("never overrides a Manual* pair (R6)", async () => {
    const pair = await seedCleanPair({ status: TokenPairStatus.ManualVerified });
    await runFactoryCheckForPair(pair.id, { now: NOW, ethCall: async () => word(OTHER) });
    expect((await testPrisma.pair.findUnique({ where: { id: pair.id } }))?.status).toBe(TokenPairStatus.ManualVerified);
  });
});

describe("pairsToFactoryCheck", () => {
  it("selects only EVM pairs with no factory resolved yet", async () => {
    const eth = await seedCleanPair();
    const checkedPair = await seedCleanPair({ factoryCheckedAt: NOW });
    const alreadyRead = await seedCleanPair({ factoryAddress: UNI_V3_FACTORY });

    const q0 = await seedToken({ chain: "qom", coingeckoCoinId: "q0" });
    const q1 = await seedToken({ chain: "qom", coingeckoCoinId: "q1" });
    const qom = await seedPair(q0.id, q1.id, { chain: "qom", dex: "qomswap_v2" });

    const ids = await pairsToFactoryCheck(NOW, 50);
    expect(ids).toContain(eth.id);
    expect(ids).not.toContain(checkedPair.id); // already checked this job
    expect(ids).not.toContain(alreadyRead.id); // factory already resolved — never re-read
    expect(ids).not.toContain(qom.id); // non-EVM chain
  });
});
