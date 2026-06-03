// Verdict runner — the DB-backed bridge that makes the pure verdict engine
// (lib/verdict.ts) runnable against real pairs. It gathers the VerdictContext
// (canonical key, per-token canonical addresses, threshold config, factory,
// verified-sibling + intra-chain-conflict flags), calls evaluatePair, and
// persists the result. This is the single shared implementation the A.4.1
// ingest, the re-verify cron and the UI rescan button all call (DRY — one
// engine, three call sites).

import { canonicalKey, fetchCanonicalContract, getCachedCanonicalAddress } from "./canonical";
import prisma from "./prisma";
import { computeReviewTier } from "./reviewTier";
import { getCanonicalFactoryAddress } from "./sourceConfig";
import { isVerifiedStatus, VERIFIED_STATUSES } from "./status";
import { promoteTokensToVerified } from "./tokenStatus";
import {
  DEFAULT_VERDICT_CONFIG,
  evaluatePair,
  VerdictConfig,
  VerdictContext,
  VerdictPairInput,
  VerdictResult,
} from "./verdict";
import { TokenPairStatus, VerificationMethod } from "../types/types";

// Structural shape of a pair loaded with both token rows — assignable from a
// Prisma `pair.findUnique({ include: { token0, token1 } })`.
type PairTokenRow = {
  contractAddress: string;
  coingeckoCoinId: string;
  decimals: number;
  deploymentTimestamp: number | null;
  isScamFlagged: boolean;
  identityConfirmed: boolean;
};
export type PairWithTokens = {
  id: string;
  chain: string;
  dex: string;
  reserveUsd: number;
  volumeUsd: number;
  txCount: number;
  factoryAddress: string | null;
  status: TokenPairStatus;
  token0PriceCg: number;
  token0PriceDex: number;
  token1PriceCg: number;
  token1PriceDex: number;
  token0: PairTokenRow;
  token1: PairTokenRow;
};

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const addrEq = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

// Order-independent compare of the two token addresses of two pairs.
const sameTokenSet = (a: [string, string], b: [string, string]): boolean => {
  const norm = ([x, y]: [string, string]) => [x.toLowerCase(), y.toLowerCase()].sort().join("|");
  return norm(a) === norm(b);
};

// Gather everything evaluatePair needs from the DB + config + CoinGecko. Returns
// both the VerdictContext and the (pure) pair input assembled from the row.
export async function buildVerdictContext(
  pair: PairWithTokens,
  opts: { now?: number } = {},
): Promise<{ context: VerdictContext; input: VerdictPairInput }> {
  const now = opts.now ?? nowSeconds();
  const key = canonicalKey({ token0: pair.token0, token1: pair.token1 });

  // Canonical addresses are read from the CanonicalAddress CACHE for every pair
  // (T3) — a cheap DB read, no CoinGecko call on the hot path. The proactive
  // canonical-check pass keeps the cache warm, so the impostor fence runs on
  // every pair, not just intra-chain conflicts. Unknown (cache miss) → null →
  // the fence skips, as before.
  let token0CanonicalAddress: string | null = pair.token0.coingeckoCoinId
    ? await getCachedCanonicalAddress(pair.token0.coingeckoCoinId, pair.chain)
    : null;
  let token1CanonicalAddress: string | null = pair.token1.coingeckoCoinId
    ? await getCachedCanonicalAddress(pair.token1.coingeckoCoinId, pair.chain)
    : null;

  const threshold = await prisma.threshold.findFirst({
    where: { chain: pair.chain, dex: pair.dex },
  });
  const config: VerdictConfig = {
    ...DEFAULT_VERDICT_CONFIG,
    minLiquidityUsd: threshold?.minLiquidityUsd ?? DEFAULT_VERDICT_CONFIG.minLiquidityUsd,
    minTxCount: threshold?.minTxCount ?? DEFAULT_VERDICT_CONFIG.minTxCount,
    minTurnoverRatio: threshold?.minTurnoverRatio ?? DEFAULT_VERDICT_CONFIG.minTurnoverRatio,
    minAgeHours: threshold?.minAgeHours ?? DEFAULT_VERDICT_CONFIG.minAgeHours,
    maxPriceDeviationPercent: threshold?.maxPriceDeviationPercent ?? DEFAULT_VERDICT_CONFIG.maxPriceDeviationPercent,
    minDecimals: threshold?.minDecimals ?? DEFAULT_VERDICT_CONFIG.minDecimals,
    maxDecimals: threshold?.maxDecimals ?? DEFAULT_VERDICT_CONFIG.maxDecimals,
    hardMinLiquidityUsd: threshold?.hardMinLiquidityUsd ?? DEFAULT_VERDICT_CONFIG.hardMinLiquidityUsd,
    autoVerifyConfidence: threshold?.autoVerifyConfidence ?? DEFAULT_VERDICT_CONFIG.autoVerifyConfidence,
  };

  let hasVerifiedSibling = false;
  let intraChainImpostorLoser = false;

  if (key) {
    const others = await prisma.pair.findMany({
      where: { canonicalKey: key, id: { not: pair.id } },
      select: {
        chain: true,
        dex: true,
        status: true,
        token0: { select: { contractAddress: true } },
        token1: { select: { contractAddress: true } },
      },
    });

    // Cross-source sibling: same canonical key on a different (chain, dex),
    // already verified. A strong "this is real" vote.
    hasVerifiedSibling = others.some(
      (o) =>
        (o.chain !== pair.chain || o.dex !== pair.dex) &&
        VERIFIED_STATUSES.includes(o.status as TokenPairStatus),
    );

    // Intra-(chain, dex) conflict: same key, same (chain, dex), but a different
    // token-address set — i.e. two different token contracts claiming the same
    // pair of coins. Only adjudicable when we know the canonical addresses.
    const thisAddrs: [string, string] = [pair.token0.contractAddress, pair.token1.contractAddress];
    const hasIntraConflict = others.some(
      (o) =>
        o.chain === pair.chain &&
        o.dex === pair.dex &&
        !sameTokenSet(thisAddrs, [o.token0.contractAddress, o.token1.contractAddress]),
    );
    if (hasIntraConflict) {
      // Conflict adjudication needs both canonical addresses for certain — if the
      // cache didn't have them, fetch live now (rare path, so the CG lookups
      // don't slow the common case).
      if (!token0CanonicalAddress && pair.token0.coingeckoCoinId) {
        token0CanonicalAddress = await fetchCanonicalContract(pair.token0.coingeckoCoinId, pair.chain, { now });
      }
      if (!token1CanonicalAddress && pair.token1.coingeckoCoinId) {
        token1CanonicalAddress = await fetchCanonicalContract(pair.token1.coingeckoCoinId, pair.chain, { now });
      }
      const canonicalKnown = !!token0CanonicalAddress && !!token1CanonicalAddress;
      const thisMatchesCanonical =
        addrEq(pair.token0.contractAddress, token0CanonicalAddress) &&
        addrEq(pair.token1.contractAddress, token1CanonicalAddress);
      // This pair is the loser only when we can confirm it does NOT match the
      // canonical addresses (the matching pair wins). Unknown canonical → leave
      // it to normal adjudication rather than guessing.
      intraChainImpostorLoser = canonicalKnown && !thisMatchesCanonical;
    }
  }

  const context: VerdictContext = {
    now,
    config,
    canonicalKey: key,
    hasVerifiedSibling,
    intraChainImpostorLoser,
    tokenScamFlagged: pair.token0.isScamFlagged || pair.token1.isScamFlagged,
    pairFactoryAddress: pair.factoryAddress, // read on-chain by the factory-check pass (T2)
    canonicalFactoryAddress: getCanonicalFactoryAddress(pair.chain, pair.dex),
  };

  const input: VerdictPairInput = {
    chain: pair.chain,
    dex: pair.dex,
    reserveUsd: pair.reserveUsd,
    volumeUsd: pair.volumeUsd,
    txCount: pair.txCount,
    token0: {
      contractAddress: pair.token0.contractAddress,
      coingeckoCoinId: pair.token0.coingeckoCoinId,
      decimals: pair.token0.decimals,
      deploymentTimestamp: pair.token0.deploymentTimestamp,
      priceCg: pair.token0PriceCg,
      priceDex: pair.token0PriceDex,
      canonicalAddress: token0CanonicalAddress,
      identityConfirmed: pair.token0.identityConfirmed,
    },
    token1: {
      contractAddress: pair.token1.contractAddress,
      coingeckoCoinId: pair.token1.coingeckoCoinId,
      decimals: pair.token1.decimals,
      deploymentTimestamp: pair.token1.deploymentTimestamp,
      priceCg: pair.token1PriceCg,
      priceDex: pair.token1PriceDex,
      canonicalAddress: token1CanonicalAddress,
      identityConfirmed: pair.token1.identityConfirmed,
    },
  };

  return { context, input };
}

export type RunVerdictOutcome = {
  found: boolean;
  persisted: boolean;
  // True when the pair was left untouched because it carries an operator
  // (Manual*) status — the verdict engine never overrides those (rule R6).
  skippedManual: boolean;
  result: VerdictResult | null;
};

// Load a pair, evaluate it, and persist the verdict (unless it's operator-set
// or persist is disabled). The canonical key is persisted alongside so later
// sibling/conflict lookups can find it.
export async function runVerdictForPair(
  pairId: string,
  opts: { now?: number; persist?: boolean } = {},
): Promise<RunVerdictOutcome> {
  const now = opts.now ?? nowSeconds();
  const persist = opts.persist !== false;

  const pair = await prisma.pair.findUnique({
    where: { id: pairId },
    include: { token0: true, token1: true },
  });
  if (!pair) {
    return { found: false, persisted: false, skippedManual: false, result: null };
  }

  // R6: never override an operator decision.
  if (pair.status === TokenPairStatus.ManualVerified || pair.status === TokenPairStatus.ManualRejected) {
    return { found: true, persisted: false, skippedManual: true, result: null };
  }

  const { context, input } = await buildVerdictContext(pair as unknown as PairWithTokens, { now });
  const result = evaluatePair(input, context);

  if (persist) {
    // Triage NeedsReview pairs into spam / review for the queue (T9); clear the
    // tier for any other verdict.
    const reviewTier =
      result.verdict === TokenPairStatus.NeedsReview
        ? computeReviewTier(result.reason, pair.token0, pair.token1)
        : null;

    await prisma.pair.update({
      where: { id: pairId },
      data: {
        status: result.verdict,
        confidence: result.confidence,
        canonicalKey: result.canonicalKey,
        verdictAt: now,
        verificationMethod: VerificationMethod.Auto,
        verificationComment: result.reason,
        verdictEvidence: result.evidence,
        reviewTier,
      },
    });

    // A verified pair implies its tokens are legit — promote them so the token
    // views reflect it (shared with the manual + bulk verify paths).
    if (isVerifiedStatus(result.verdict)) {
      await promoteTokensToVerified([pair.token0Id, pair.token1Id]);
    }
  }

  return { found: true, persisted: persist, skippedManual: false, result };
}
