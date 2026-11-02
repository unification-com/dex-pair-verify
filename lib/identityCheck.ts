// DB-backed multi-source identity check (Phase 5, T1). The counterpart to
// scamCheck.ts: a batched pass that resolves token identity for the tokens that
// actually block auto-verify — those WITHOUT a CoinGecko coin id — persists the
// result, and (when newly confirmed) re-runs the verdict on the token's pairs so
// a now-identified pair leaves NeedsReview immediately.
//
// Decoupled from the verdict engine the same way scam-check is: the slow network
// resolution runs here + caches identityConfirmed on the Token; runVerdictForPair
// just reads that flag. So `yarn revalidate` stays fast.

import { Prisma } from "@prisma/client";

import { evmChainId, EVM_SUPPORTED_CHAINS } from "./chains";
import { ResolveDeps, resolveTokenIdentity } from "./identity/resolve";
import prisma from "./prisma";
import { RECHECK_TTL_S } from "./recheck";
import { TokenSecurity } from "./scamCheck";
import { isVerifiedStatus } from "./status";
import { nowSeconds } from "./time";
import { runVerdictForPair } from "./verdictRunner";
import { TokenPairStatus } from "../types/types";

// Pairs whose verdict an identity result can change: those in review, and those
// at or above their source's soft liquidity floor. Below it, an unidentified token's
// pool is auto-rejected (AV-2) and an identified one still can't auto-verify
// (liquidity is a core gate), so checking those tokens only spends API quota. A
// source without a Threshold row has a floor of 0, so all its pools count. A pool
// that later deepens comes back into scope on the next ingest.
async function identityRelevantPairs(): Promise<Prisma.PairWhereInput> {
  const floors = await prisma.threshold.findMany({ select: { chain: true, dex: true, minLiquidityUsd: true } });
  return {
    OR: [
      { status: TokenPairStatus.NeedsReview },
      ...floors.map((t) => ({ chain: t.chain, dex: t.dex, reserveUsd: { gte: t.minLiquidityUsd } })),
      { NOT: { OR: floors.map((t) => ({ chain: t.chain, dex: t.dex })) } },
    ],
  };
}

// Tokens worth identity-checking: no CoinGecko coin id (cgId-bearing tokens are
// already "identified"), on an EVM chain we map, in ≥1 pair the result can affect,
// and not yet checked this job (identityCheckedAt < jobStartedAt). With `dueBy`
// (the pipeline) only tokens whose back-off has expired are due; without it (the
// on-demand UI runner) every such token is. Mirrors scamCheck's resumable batch
// contract.
async function identityCheckWhere(jobStartedAt: number, dueBy?: number): Promise<Prisma.TokenWhereInput> {
  const relevant = await identityRelevantPairs();
  return {
    coingeckoCoinId: "",
    chain: { in: EVM_SUPPORTED_CHAINS },
    identityCheckedAt: { lt: jobStartedAt },
    ...(dueBy === undefined ? {} : { identityNextCheckAt: { lte: dueBy } }),
    OR: [{ pairsToken0: { some: relevant } }, { pairsToken1: { some: relevant } }],
  };
}

const CONFIRMED_RECHECK_S = 30 * 86_400;
const MAX_BACKOFF_S = 90 * 86_400;

// When the identity pass should next look at a token. Confirmed: in a month.
// Unconfirmed: back off, doubling the previous gap from the base (the pipeline's
// recheck window) up to 90 days, restarting at the base after a confirmed result.
export function nextIdentityCheckAt(
  prev: { checkedAt: number; nextCheckAt: number; confirmed: boolean },
  confirmed: boolean,
  now: number,
  baseS = RECHECK_TTL_S,
): number {
  if (confirmed) {
    return now + CONFIRMED_RECHECK_S;
  }
  const prevGap = !prev.confirmed && prev.checkedAt > 0 ? Math.max(0, prev.nextCheckAt - prev.checkedAt) : 0;
  return now + Math.min(MAX_BACKOFF_S, Math.max(baseS, prevGap * 2));
}

export async function tokensToIdentityCheck(jobStartedAt: number, batch: number, opts: { dueBy?: number } = {}): Promise<string[]> {
  const rows = await prisma.token.findMany({
    where: await identityCheckWhere(jobStartedAt, opts.dueBy),
    select: { id: true },
    take: batch,
  });
  return rows.map((r) => r.id);
}

export async function countTokensToIdentityCheck(jobStartedAt: number, opts: { dueBy?: number } = {}): Promise<number> {
  return prisma.token.count({ where: await identityCheckWhere(jobStartedAt, opts.dueBy) });
}

export type IdentityCheckOutcome = {
  checked: boolean; // false when not applicable (cgId present / non-EVM / missing)
  confirmed: boolean;
  promotedPairs: number; // pairs that became verified after re-running the verdict
};

const hasCgId = (cgId: string | null | undefined): boolean => (cgId ?? "").trim().length > 0;

// Resolve + persist identity for one token; on a fresh confirmation re-run the
// verdict for each of its pairs (R6-safe inside runVerdictForPair).
export async function runIdentityCheckForToken(
  tokenId: string,
  opts: { now?: number; deps?: ResolveDeps } = {},
): Promise<IdentityCheckOutcome> {
  const now = opts.now ?? nowSeconds();

  const token = await prisma.token.findUnique({ where: { id: tokenId } });
  if (!token) {
    return { checked: false, confirmed: false, promotedPairs: 0 };
  }

  // Defensive stamp: any token that reaches here is marked checked, even on the
  // early-out guards below. The batch where-clause already excludes these cases,
  // but stamping unconditionally removes the reliance on where-clause/guard
  // agreement (a divergence would otherwise be an infinite drain loop) — matching
  // the stamp-on-miss contract the canonical/scam/factory passes uphold.
  const stampChecked = (): Promise<unknown> =>
    prisma.token.update({ where: { id: token.id }, data: { identityCheckedAt: now } });

  // CG-listed → already identified via cgId; nothing for this pass to do.
  if (hasCgId(token.coingeckoCoinId)) {
    await stampChecked();
    return { checked: false, confirmed: true, promotedPairs: 0 };
  }
  if (evmChainId(token.chain) === null) {
    await stampChecked();
    return { checked: false, confirmed: false, promotedPairs: 0 };
  }

  const existingSecurity = (token.goPlusData as TokenSecurity | null) ?? null;
  const { result, coingeckoCoinId, coinmarketcapSlug } = await resolveTokenIdentity(token.chain, token.contractAddress, {
    now,
    existingSecurity,
    ...(opts.deps ?? {}),
  });

  await prisma.token.update({
    where: { id: token.id },
    data: {
      identityData: result.signals as unknown as Prisma.InputJsonValue,
      identityConfirmed: result.confirmed,
      identityCheckedAt: now,
      identityNextCheckAt: nextIdentityCheckAt(
        { checkedAt: token.identityCheckedAt, nextCheckAt: token.identityNextCheckAt, confirmed: token.identityConfirmed },
        result.confirmed,
        now,
      ),
      // Backfill the CoinGecko id when the reverse lookup found one — the token is
      // now properly CG-listed (identity via cgId + the canonical check can run).
      ...(coingeckoCoinId ? { coingeckoCoinId } : {}),
      // Backfill the CoinMarketCap slug for the token-page link (B1d).
      ...(coinmarketcapSlug ? { coinmarketcapSlug } : {}),
    },
  });

  let promotedPairs = 0;
  if (result.confirmed) {
    const pairs = await prisma.pair.findMany({
      where: { OR: [{ token0Id: token.id }, { token1Id: token.id }] },
      select: { id: true },
    });
    for (const p of pairs) {
      const out = await runVerdictForPair(p.id, { now });
      if (out.result && isVerifiedStatus(out.result.verdict as TokenPairStatus)) {
        promotedPairs += 1;
      }
    }
  }

  return { checked: true, confirmed: result.confirmed, promotedPairs };
}
