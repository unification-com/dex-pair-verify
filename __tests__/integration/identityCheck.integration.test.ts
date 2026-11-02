// Integration tests for runIdentityCheckForToken + tokensToIdentityCheck (T1).
// The token-list + GoPlus calls are stubbed via injected deps; asserts identity
// is persisted, and a no-cgId pair is promoted out of NeedsReview once BOTH of
// its tokens are independently identity-confirmed.

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetDb, seedPair, seedThreshold, seedToken, testPrisma } from "./helpers";
import { runIdentityCheckForToken, tokensToIdentityCheck } from "../../lib/identityCheck";
import { TokenPairStatus } from "../../types/types";

const NOW = 1_700_000_000;

// Deps that confirm two independent categories (token list + GoPlus trust list).
// cgReverse + trustWallet + cmcReverse stubbed to "not found" so the resolver
// never hits the live CoinGecko / Trust Wallet / CoinMarketCap endpoints.
const confirmingDeps = {
  cgReverse: async () => ({ id: null }),
  trustWallet: async () => false,
  cmcReverse: async () => ({ found: false, slug: null }),
  listMembership: async () => ["uniswap-default"],
  fetchSecurity: async () => ({ trust_list: "1" }),
};
// Only GoPlus vouches (not a self-sufficient category) and no list → below the
// bar. (A token-list match alone WOULD confirm — that's the vetted-signal path.)
const oneCategoryDeps = {
  cgReverse: async () => ({ id: null }),
  trustWallet: async () => false,
  cmcReverse: async () => ({ found: false, slug: null }),
  listMembership: async () => [],
  fetchSecurity: async () => ({ trust_list: "1" }),
};

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("runIdentityCheckForToken", () => {
  it("confirms a no-cgId token and promotes its pair once BOTH tokens are confirmed", async () => {
    const t0 = await seedToken({ symbol: "AAA" }); // coingeckoCoinId "" by default
    const t1 = await seedToken({ symbol: "BBB" });
    const pair = await seedPair(t0.id, t1.id, { status: TokenPairStatus.NeedsReview });

    // First token confirmed, but its partner isn't yet → pair stays in review.
    const out0 = await runIdentityCheckForToken(t0.id, { now: NOW, deps: confirmingDeps });
    expect(out0.confirmed).toBe(true);
    expect(out0.promotedPairs).toBe(0);
    expect((await testPrisma.pair.findUnique({ where: { id: pair.id } }))?.status).toBe(TokenPairStatus.NeedsReview);

    // Second token confirmed → both identified → verdict re-run promotes it.
    const out1 = await runIdentityCheckForToken(t1.id, { now: NOW, deps: confirmingDeps });
    expect(out1.confirmed).toBe(true);
    expect(out1.promotedPairs).toBe(1);
    expect((await testPrisma.pair.findUnique({ where: { id: pair.id } }))?.status).toBe(TokenPairStatus.AutoVerified);

    const token = await testPrisma.token.findUnique({ where: { id: t0.id } });
    expect(token?.identityConfirmed).toBe(true);
    expect(token?.identityData).toBeTruthy(); // raw per-source signals stored
    expect(token?.identityCheckedAt).toBe(NOW);
  });

  it("does not confirm (or promote) when only one category vouches", async () => {
    const t0 = await seedToken();
    const t1 = await seedToken();
    const pair = await seedPair(t0.id, t1.id, { status: TokenPairStatus.NeedsReview });

    const out = await runIdentityCheckForToken(t0.id, { now: NOW, deps: oneCategoryDeps });
    expect(out.confirmed).toBe(false);
    expect(out.promotedPairs).toBe(0);

    const token = await testPrisma.token.findUnique({ where: { id: t0.id } });
    expect(token?.identityConfirmed).toBe(false);
    expect(token?.identityCheckedAt).toBe(NOW); // still stamped (won't re-check)
    expect((await testPrisma.pair.findUnique({ where: { id: pair.id } }))?.status).toBe(TokenPairStatus.NeedsReview);
  });

  it("skips the identity resolution for a CoinGecko-listed token (already identified via cgId)", async () => {
    const t0 = await seedToken({ coingeckoCoinId: "weth" });
    const out = await runIdentityCheckForToken(t0.id, { now: NOW, deps: confirmingDeps });
    expect(out.checked).toBe(false); // no resolution ran — cgId already identifies it
    const token = await testPrisma.token.findUnique({ where: { id: t0.id } });
    expect(token?.identityCheckedAt).toBe(NOW); // but defensively stamped so the drain loop can't spin
  });

  it("never overrides a Manual* pair (R6)", async () => {
    const t0 = await seedToken();
    const t1 = await seedToken();
    const pair = await seedPair(t0.id, t1.id, { status: TokenPairStatus.ManualRejected });
    await runIdentityCheckForToken(t0.id, { now: NOW, deps: confirmingDeps });
    await runIdentityCheckForToken(t1.id, { now: NOW, deps: confirmingDeps });
    expect((await testPrisma.pair.findUnique({ where: { id: pair.id } }))?.status).toBe(TokenPairStatus.ManualRejected);
  });
});

describe("tokensToIdentityCheck", () => {
  it("selects only no-cgId EVM pair tokens not yet checked", async () => {
    const t0 = await seedToken(); // no cgId, eth, in a pair → included
    const t1 = await seedToken();
    await seedPair(t0.id, t1.id, { status: TokenPairStatus.NeedsReview });

    await seedToken({ coingeckoCoinId: "weth" }); // has cgId → excluded (and orphan)
    const checked = await seedToken({ identityCheckedAt: NOW }); // already checked → excluded
    const partner = await seedToken();
    await seedPair(checked.id, partner.id, { status: TokenPairStatus.NeedsReview });

    const q0 = await seedToken({ chain: "qom" }); // non-EVM → excluded
    const q1 = await seedToken({ chain: "qom" });
    await seedPair(q0.id, q1.id, { chain: "qom", dex: "qomswap_v2", status: TokenPairStatus.NeedsReview });

    const ids = await tokensToIdentityCheck(NOW, 50);
    // t0, t1, and `partner` (no cgId, in a pair, unchecked) qualify; `checked`
    // and the cgId/qom tokens do not.
    expect(ids.sort()).toEqual([t0.id, t1.id, partner.id].sort());
  });
});

describe("tokensToIdentityCheck scope", () => {
  // A token paired with a cgId-bearing partner, so only `token` is identity-eligible.
  async function soloToken(pair: { reserveUsd: number; status: TokenPairStatus; dex?: string }, over = {}) {
    const token = await seedToken(over);
    const partner = await seedToken({ coingeckoCoinId: "weth" });
    await seedPair(token.id, partner.id, pair);
    return token;
  }

  it("skips tokens whose pools are all below their source's soft liquidity floor", async () => {
    await seedThreshold({ chain: "eth", dex: "uniswap_v3", minLiquidityUsd: 25_000 });
    const deep = await soloToken({ reserveUsd: 50_000, status: TokenPairStatus.AutoRejected });
    await soloToken({ reserveUsd: 5_000, status: TokenPairStatus.AutoRejected });
    const inReview = await soloToken({ reserveUsd: 5_000, status: TokenPairStatus.NeedsReview });
    // A source with no Threshold row has a floor of 0, so its pools count.
    const unfloored = await soloToken({ reserveUsd: 100, status: TokenPairStatus.AutoRejected, dex: "sushiswap" });

    expect((await tokensToIdentityCheck(NOW, 50)).sort()).toEqual([deep.id, inReview.id, unfloored.id].sort());
  });

  it("with a due date, skips tokens whose back-off hasn't expired", async () => {
    const due = await soloToken({ reserveUsd: 50_000, status: TokenPairStatus.NeedsReview }, { identityNextCheckAt: NOW - 1 });
    const later = await soloToken({ reserveUsd: 50_000, status: TokenPairStatus.NeedsReview }, { identityNextCheckAt: NOW + 86_400 });

    expect(await tokensToIdentityCheck(NOW, 50, { dueBy: NOW })).toEqual([due.id]);
    // The on-demand runner (no due date) still checks both.
    expect((await tokensToIdentityCheck(NOW, 50)).sort()).toEqual([due.id, later.id].sort());
  });
});

describe("runIdentityCheckForToken back-off", () => {
  const DAY = 86_400;

  it("schedules a miss after the base window, then doubles; a confirmation in a month", async () => {
    const token = await seedToken();
    const next = async () => (await testPrisma.token.findUniqueOrThrow({ where: { id: token.id } })).identityNextCheckAt;

    await runIdentityCheckForToken(token.id, { now: NOW, deps: oneCategoryDeps });
    expect(await next()).toBe(NOW + 7 * DAY);

    await runIdentityCheckForToken(token.id, { now: NOW + 7 * DAY, deps: oneCategoryDeps });
    expect(await next()).toBe(NOW + 21 * DAY);

    await runIdentityCheckForToken(token.id, { now: NOW + 21 * DAY, deps: confirmingDeps });
    expect(await next()).toBe(NOW + 51 * DAY);
  });
});
