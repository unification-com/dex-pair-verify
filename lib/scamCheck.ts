// Scam-list check via GoPlus (A.7). Stores the raw GoPlus security response on
// the Token (alongside its other DEX metadata) plus a derived flag, and demotes
// any AutoVerified pair using a flagged token to NeedsReview — never
// auto-rejected, because the operator decides (false positives exist). Free
// GoPlus tier is 30 req/min, so callers run this cached + throttled over the
// (smaller) verified set, not every token every run.

import { Prisma } from "@prisma/client";

import { evmChainId, EVM_SUPPORTED_CHAINS } from "./chains";
import { makePacedFetch } from "./httpBackoff";
import prisma from "./prisma";
import { VERIFIED_STATUSES } from "./status";
import { runVerdictForPair } from "./verdictRunner";
import { TokenPairStatus } from "../types/types";

// GoPlus indexes by EVM chain id (as a string). null = not an EVM chain we map
// (e.g. qom), so the check is skipped — same posture as its CG/GT coverage.
export const goplusChainId = (chain: string): string | null => {
  const id = evmChainId(chain);
  return id === null ? null : String(id);
};

// Chains GoPlus indexes — used to scope the scan-check batch query.
export const GOPLUS_SUPPORTED_CHAINS: string[] = EVM_SUPPORTED_CHAINS;

// Tokens worth scam-checking: those belonging to a verified pair, on a
// GoPlus-supported chain, not yet checked this job (scamCheckedAt <
// jobStartedAt). Only verified-pair tokens matter — a flag only acts by
// demoting AutoVerified pairs, so unverified tokens aren't worth the quota.
const scamCheckWhere = (jobStartedAt: number): Prisma.TokenWhereInput => ({
  chain: { in: GOPLUS_SUPPORTED_CHAINS },
  scamCheckedAt: { lt: jobStartedAt },
  OR: [
    { pairsToken0: { some: { status: { in: [...VERIFIED_STATUSES] } } } },
    { pairsToken1: { some: { status: { in: [...VERIFIED_STATUSES] } } } },
  ],
});

// The next batch of token ids to scam-check.
export async function tokensToScamCheck(jobStartedAt: number, batch: number): Promise<string[]> {
  const rows = await prisma.token.findMany({
    where: scamCheckWhere(jobStartedAt),
    select: { id: true },
    take: batch,
  });
  return rows.map((r) => r.id);
}

// How many tokens still need checking this job — backs the progress UI.
export async function countTokensToScamCheck(jobStartedAt: number): Promise<number> {
  return prisma.token.count({ where: scamCheckWhere(jobStartedAt) });
}

// Buy/sell tax above this is treated as a scam signal.
const HIGH_TAX = 0.1;

export type TokenSecurity = Record<string, unknown>;
export type SecurityFetcher = (chainId: string, address: string) => Promise<TokenSecurity | null>;

// GoPlus free tier is 30 req/min. Pace under it (one call / 2.5s ≈ 24/min) so
// the scam + identity passes — both route through fetchTokenSecurity — can't
// 429-storm the shared GoPlus budget. Same gate primitive as the CoinGecko path
// (DRY), with GoPlus's own independent schedule.
const GOPLUS_CALL_SPACING_MS = 2500;
const pacedGoplusFetch = makePacedFetch(GOPLUS_CALL_SPACING_MS);

// The default GoPlus token-security fetch. Exported so the identity resolver
// (T1) reuses the exact same paced call + back-off rather than duplicating it (DRY).
export const fetchTokenSecurity: SecurityFetcher = async (chainId, address) => {
  const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`;
  const res = await pacedGoplusFetch(url, `scamcheck ${chainId}`);
  if (!res) {
    return null;
  }
  const json = await res.json();
  const result = json?.result as Record<string, TokenSecurity> | undefined;
  if (!result) {
    return null;
  }
  // GoPlus keys the result by the lower-cased address.
  return result[address.toLowerCase()] ?? null;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const flt = (v: unknown): number => parseFloat(str(v));

export type ScamEvaluation = { flagged: boolean; reasons: string[] };

// Map the GoPlus signals onto a flag + human reasons. Only STRONG, direct
// evidence that a holder can't safely sell flags a token: the honeypot family,
// self-destruct, and extreme tax. Two GoPlus signals are deliberately EXCLUDED
// because they false-positive on legitimate, established tokens (they demoted
// RSR, BAND, OCEAN, PHA, sUSDe, CGPT… in the 2026-06-04 run):
//   - hidden_owner — normal for legit upgradeable-proxy / multisig / governance
//     contracts; not evidence a holder is trapped.
//   - honeypot_with_same_creator — guilt-by-association; trips on prolific /
//     launchpad deployers who also shipped an unrelated flagged contract.
// (mintable / pausable are likewise excluded — legit tokens have them.) Holding
// the flag set to genuine bad actors keeps real tokens out of the spam queue.
export function evaluateScamSignals(s: TokenSecurity | null): ScamEvaluation {
  if (!s) {
    return { flagged: false, reasons: [] };
  }
  const reasons: string[] = [];
  if (str(s.is_honeypot) === "1") reasons.push("honeypot");
  if (str(s.cannot_sell_all) === "1") reasons.push("cannot sell all");
  if (str(s.selfdestruct) === "1") reasons.push("self-destruct");

  const buyTax = flt(s.buy_tax);
  const sellTax = flt(s.sell_tax);
  if (Number.isFinite(buyTax) && buyTax > HIGH_TAX) reasons.push(`high buy tax ${Math.round(buyTax * 100)}%`);
  if (Number.isFinite(sellTax) && sellTax > HIGH_TAX) reasons.push(`high sell tax ${Math.round(sellTax * 100)}%`);

  return { flagged: reasons.length > 0, reasons };
}

export type ScamCheckOutcome = {
  checked: boolean; // false when the chain isn't on GoPlus / token missing / fetch failed
  flagged: boolean;
  reasons: string[];
  demotedPairs: number;
};

// Check one token: store the GoPlus data on it, derive the flag, and demote any
// AutoVerified pair using it. R6: Manual* pairs are never touched.
export async function runScamCheckForToken(
  tokenId: string,
  opts: { now?: number; fetcher?: SecurityFetcher } = {},
): Promise<ScamCheckOutcome> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const fetcher = opts.fetcher ?? fetchTokenSecurity;

  const token = await prisma.token.findUnique({ where: { id: tokenId } });
  if (!token) {
    return { checked: false, flagged: false, reasons: [], demotedPairs: 0 };
  }

  const chainId = goplusChainId(token.chain);
  if (!chainId) {
    return { checked: false, flagged: false, reasons: [], demotedPairs: 0 };
  }

  const security = await fetcher(chainId, token.contractAddress);
  if (security === null) {
    // No GoPlus data (address not indexed) or a transient miss. Stamp the attempt
    // so the batch loop terminates instead of re-fetching this token forever — a
    // later job (newer jobStartedAt) re-checks. Don't clobber existing metadata.
    await prisma.token.update({ where: { id: token.id }, data: { scamCheckedAt: now } });
    return { checked: false, flagged: false, reasons: [], demotedPairs: 0 };
  }

  const { flagged, reasons } = evaluateScamSignals(security);
  const scamReason = reasons.join(", ");

  await prisma.token.update({
    where: { id: token.id },
    data: {
      goPlusData: security as Prisma.InputJsonValue,
      isScamFlagged: flagged,
      scamReason,
      scamCheckedAt: now,
    },
  });

  let demotedPairs = 0;
  if (flagged) {
    // Re-run the verdict for each of the token's pairs — now that isScamFlagged
    // is set, the scam fence routes them to NeedsReview AND the review-tier /
    // confidence are recomputed. Consistent with the identity/canonical/factory
    // passes (all use runVerdictForPair), so no separate revalidate is needed.
    // R6-safe inside runVerdictForPair (Manual* pairs untouched).
    const pairs = await prisma.pair.findMany({
      where: { OR: [{ token0Id: token.id }, { token1Id: token.id }] },
      select: { id: true, status: true },
    });
    for (const p of pairs) {
      const wasVerified = p.status === TokenPairStatus.AutoVerified;
      const out = await runVerdictForPair(p.id, { now });
      if (wasVerified && out.result?.verdict === TokenPairStatus.NeedsReview) {
        demotedPairs += 1;
      }
    }
  }

  return { checked: true, flagged, reasons, demotedPairs };
}

// --- Re-score from cache (apply a rule change without re-fetching GoPlus) ----

// Tokens that have been scam-checked at least once — the candidates for a
// cache re-score. (Some have no GoPlus data — null fetch result — and are
// skipped by rescoreScamForToken; gating on scamCheckedAt sidesteps Prisma's
// fiddly JSON-null filtering.)
export async function tokensToRescore(): Promise<string[]> {
  const rows = await prisma.token.findMany({
    where: { scamCheckedAt: { gt: 0 } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export type RescoreOutcome = {
  changed: boolean; // the flag flipped vs what was stored
  flagged: boolean; // the new flag value
  affectedPairs: number; // pairs re-verified because the flag changed
};

// Re-evaluate one token's CACHED GoPlus data against the CURRENT
// evaluateScamSignals rule — no GoPlus call. If the flag flips (a rule tweak
// added or removed it), persist the new flag/reason and re-run the verdict for
// the token's pairs so the change propagates (cleared flag → re-verify, new flag
// → demote). This is how a scam-rule change is applied to already-checked
// tokens: instant + quota-free, and it reaches tokens a fresh scancheck would
// skip (e.g. one demoted out of every verified pair). R6-safe via runVerdictForPair.
export async function rescoreScamForToken(
  tokenId: string,
  opts: { now?: number } = {},
): Promise<RescoreOutcome> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const token = await prisma.token.findUnique({ where: { id: tokenId } });
  if (!token || token.goPlusData == null) {
    return { changed: false, flagged: false, affectedPairs: 0 };
  }

  const { flagged, reasons } = evaluateScamSignals(token.goPlusData as TokenSecurity);
  if (flagged === token.isScamFlagged) {
    return { changed: false, flagged, affectedPairs: 0 };
  }

  await prisma.token.update({
    where: { id: token.id },
    data: { isScamFlagged: flagged, scamReason: reasons.join(", ") },
  });

  const pairs = await prisma.pair.findMany({
    where: { OR: [{ token0Id: token.id }, { token1Id: token.id }] },
    select: { id: true },
  });
  for (const p of pairs) {
    await runVerdictForPair(p.id, { now });
  }

  return { changed: true, flagged, affectedPairs: pairs.length };
}
