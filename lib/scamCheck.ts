// Scam-list check via GoPlus (A.7). Stores the raw GoPlus security response on
// the Token (alongside its other DEX metadata) plus a derived flag, and demotes
// any AutoVerified pair using a flagged token to NeedsReview — never
// auto-rejected, because the operator decides (false positives exist). Free
// GoPlus tier is 30 req/min, so callers run this cached + throttled over the
// (smaller) verified set, not every token every run.

import { Prisma } from "@prisma/client";

import { fetchWithBackoff } from "./httpBackoff";
import prisma from "./prisma";
import { VERIFIED_STATUSES } from "./status";
import { TokenPairStatus } from "../types/types";

// GoPlus numeric chain id per our chain key. null = GoPlus doesn't index it
// (e.g. qom), so the check is skipped — same posture as its CG/GT coverage.
const GOPLUS_CHAIN_ID: Record<string, string | null> = {
  eth: "1",
  bsc: "56",
  polygon_pos: "137",
  xdai: "100",
  qom: null,
};

export const goplusChainId = (chain: string): string | null => GOPLUS_CHAIN_ID[chain] ?? null;

// Chains GoPlus indexes — used to scope the scan-check batch query.
export const GOPLUS_SUPPORTED_CHAINS: string[] = Object.entries(GOPLUS_CHAIN_ID)
  .filter(([, id]) => id !== null)
  .map(([chain]) => chain);

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

const defaultFetcher: SecurityFetcher = async (chainId, address) => {
  const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`;
  const res = await fetchWithBackoff(url, undefined, `scamcheck ${chainId}`);
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

// Map the GoPlus signals onto a flag + human reasons. Conservative — only
// strong scam indicators flag (honeypot family, self-destruct, hidden owner,
// extreme tax). Mintable / pausable are deliberately excluded (legit tokens
// have them) to keep the NeedsReview queue small.
export function evaluateScamSignals(s: TokenSecurity | null): ScamEvaluation {
  if (!s) {
    return { flagged: false, reasons: [] };
  }
  const reasons: string[] = [];
  if (str(s.is_honeypot) === "1") reasons.push("honeypot");
  if (str(s.cannot_sell_all) === "1") reasons.push("cannot sell all");
  if (str(s.honeypot_with_same_creator) === "1") reasons.push("honeypot-linked creator");
  if (str(s.selfdestruct) === "1") reasons.push("self-destruct");
  if (str(s.hidden_owner) === "1") reasons.push("hidden owner");

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
  const fetcher = opts.fetcher ?? defaultFetcher;

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
    // Transient failure / no data — don't clobber existing metadata.
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
    const demote = await prisma.pair.updateMany({
      where: {
        status: TokenPairStatus.AutoVerified,
        OR: [{ token0Id: token.id }, { token1Id: token.id }],
      },
      data: {
        status: TokenPairStatus.NeedsReview,
        verificationComment: `scam flag (${token.symbol}): ${scamReason}`,
      },
    });
    demotedPairs = demote.count;
  }

  return { checked: true, flagged, reasons, demotedPairs };
}
