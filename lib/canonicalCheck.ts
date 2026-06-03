// DB-backed proactive canonical-address resolution (Phase 5, T3). Resolves the
// CoinGecko-canonical contract for every cgId-bearing pair token into the
// CanonicalAddress cache, then re-runs the verdict so the impostor fence (token
// address vs canonical) runs on EVERY pair — not just intra-chain conflicts.
//
// The slow CoinGecko calls live here (cached + paced); buildVerdictContext just
// reads the warm cache via getCachedCanonicalAddress. Resumable via Token
// .canonicalCheckedAt. Mirrors the scam/identity/factory passes.

import { Prisma } from "@prisma/client";

import { CG_SUPPORTED_CHAINS, cgPlatformForChain, fetchCanonicalContract, PlatformsFetcher } from "./canonical";
import prisma from "./prisma";
import { runVerdictForPair } from "./verdictRunner";

const hasCgId = (cgId: string | null | undefined): boolean => (cgId ?? "").trim().length > 0;

// Tokens worth a canonical resolution: have a cgId, on a CoinGecko-supported
// chain, in ≥1 pair, not yet checked this job.
const canonicalCheckWhere = (jobStartedAt: number): Prisma.TokenWhereInput => ({
  coingeckoCoinId: { not: "" },
  chain: { in: CG_SUPPORTED_CHAINS },
  canonicalCheckedAt: { lt: jobStartedAt },
  OR: [{ pairsToken0: { some: {} } }, { pairsToken1: { some: {} } }],
});

export async function tokensToCanonicalCheck(jobStartedAt: number, batch: number): Promise<string[]> {
  const rows = await prisma.token.findMany({
    where: canonicalCheckWhere(jobStartedAt),
    select: { id: true },
    take: batch,
  });
  return rows.map((r) => r.id);
}

export async function countTokensToCanonicalCheck(jobStartedAt: number): Promise<number> {
  return prisma.token.count({ where: canonicalCheckWhere(jobStartedAt) });
}

export type CanonicalCheckOutcome = {
  checked: boolean;
  hasAddress: boolean; // a canonical contract was resolved (vs "no contract here")
  impostorPairs: number; // pairs routed to review because a token != canonical
};

// Resolve + cache one token's canonical address, then re-run its pairs' verdicts.
export async function runCanonicalCheckForToken(
  tokenId: string,
  opts: { now?: number; fetcher?: PlatformsFetcher } = {},
): Promise<CanonicalCheckOutcome> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  const token = await prisma.token.findUnique({ where: { id: tokenId } });
  if (!token) {
    return { checked: false, hasAddress: false, impostorPairs: 0 };
  }
  if (!hasCgId(token.coingeckoCoinId) || !cgPlatformForChain(token.chain)) {
    return { checked: false, hasAddress: false, impostorPairs: 0 };
  }

  const canonical = await fetchCanonicalContract(token.coingeckoCoinId, token.chain, { now, fetcher: opts.fetcher });

  // Distinguish a definitive answer (a cache row exists — an address or a
  // negative "") from a transient CoinGecko failure (no cache row). Only stamp
  // canonicalCheckedAt on a definitive answer so transient misses retry.
  const cacheRow = await prisma.canonicalAddress.findUnique({
    where: { coingeckoCoinId_chain: { coingeckoCoinId: token.coingeckoCoinId, chain: token.chain } },
  });
  if (!cacheRow) {
    return { checked: false, hasAddress: false, impostorPairs: 0 };
  }

  await prisma.token.update({ where: { id: token.id }, data: { canonicalCheckedAt: now } });

  // Only a known address can change a verdict (activate the impostor fence).
  let impostorPairs = 0;
  if (canonical) {
    const pairs = await prisma.pair.findMany({
      where: { OR: [{ token0Id: token.id }, { token1Id: token.id }] },
      select: { id: true },
    });
    for (const p of pairs) {
      const out = await runVerdictForPair(p.id, { now });
      if (out.result?.reason.includes("impostor")) {
        impostorPairs += 1;
      }
    }
  }

  return { checked: true, hasAddress: !!canonical, impostorPairs };
}
