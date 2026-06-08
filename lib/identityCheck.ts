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
import { TokenSecurity } from "./scamCheck";
import { isVerifiedStatus } from "./status";
import { runVerdictForPair } from "./verdictRunner";
import { TokenPairStatus } from "../types/types";

// Tokens worth identity-checking: no CoinGecko coin id (cgId-bearing tokens are
// already "identified"), on an EVM chain we map, belonging to ≥1 pair, and not
// yet checked this job (identityCheckedAt < jobStartedAt). Mirrors scamCheck's
// resumable batch contract.
const identityCheckWhere = (jobStartedAt: number): Prisma.TokenWhereInput => ({
  coingeckoCoinId: "",
  chain: { in: EVM_SUPPORTED_CHAINS },
  identityCheckedAt: { lt: jobStartedAt },
  OR: [{ pairsToken0: { some: {} } }, { pairsToken1: { some: {} } }],
});

export async function tokensToIdentityCheck(jobStartedAt: number, batch: number): Promise<string[]> {
  const rows = await prisma.token.findMany({
    where: identityCheckWhere(jobStartedAt),
    select: { id: true },
    take: batch,
  });
  return rows.map((r) => r.id);
}

export async function countTokensToIdentityCheck(jobStartedAt: number): Promise<number> {
  return prisma.token.count({ where: identityCheckWhere(jobStartedAt) });
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
  const now = opts.now ?? Math.floor(Date.now() / 1000);

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
