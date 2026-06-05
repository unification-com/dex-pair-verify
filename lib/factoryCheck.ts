// DB-backed on-chain factory check (Phase 5, T2). The pair-level counterpart to
// scamCheck/identityCheck: reads each pool's factory() via RPC, persists it, and
// re-runs the verdict so a factory match raises confidence and a mismatch routes
// the pair to Needs Review. Decoupled from the verdict engine the same way — the
// slow RPC read caches Pair.factoryAddress; runVerdictForPair just reads it.
//
// Factory addresses are immutable per pool, so each pair is read once
// (factoryCheckedAt gates re-runs).

import { Prisma } from "@prisma/client";

import { EVM_SUPPORTED_CHAINS } from "./chains";
import { EthCaller, readPoolFactory } from "./onchain/factory";
import prisma from "./prisma";
import { getCanonicalFactoryAddress } from "./sourceConfig";
import { runVerdictForPair } from "./verdictRunner";
import { TokenPairStatus } from "../types/types";

const addrEq = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

// Pairs worth a factory read: on an EVM chain, with no factory resolved YET
// (factory is immutable, so once read we never re-read), not yet checked this
// job. The `factoryAddress: null` clause means a re-run only retries the ones a
// failed/dead RPC left unread — it won't re-read the ones already resolved.
const factoryCheckWhere = (jobStartedAt: number): Prisma.PairWhereInput => ({
  chain: { in: EVM_SUPPORTED_CHAINS },
  factoryAddress: null,
  factoryCheckedAt: { lt: jobStartedAt },
});

export async function pairsToFactoryCheck(jobStartedAt: number, batch: number): Promise<string[]> {
  const rows = await prisma.pair.findMany({
    where: factoryCheckWhere(jobStartedAt),
    select: { id: true },
    take: batch,
  });
  return rows.map((r) => r.id);
}

export async function countPairsToFactoryCheck(jobStartedAt: number): Promise<number> {
  return prisma.pair.count({ where: factoryCheckWhere(jobStartedAt) });
}

export type FactoryCheckOutcome = {
  checked: boolean;
  factoryFound: boolean;
  mismatch: boolean; // factory read AND differs from the canonical factory
  verdict: TokenPairStatus | null;
};

// Read + persist one pair's factory, then re-run its verdict if we learned it.
export async function runFactoryCheckForPair(
  pairId: string,
  opts: { now?: number; ethCall?: EthCaller } = {},
): Promise<FactoryCheckOutcome> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  const pair = await prisma.pair.findUnique({ where: { id: pairId } });
  if (!pair) {
    return { checked: false, factoryFound: false, mismatch: false, verdict: null };
  }

  const factory = await readPoolFactory(pair.chain, pair.contractAddress, { ethCall: opts.ethCall });

  // Stamp the attempt regardless (factory is immutable; a transient RPC miss
  // leaves factoryAddress null so the fence simply skips, and can be re-run by
  // clearing factoryCheckedAt).
  await prisma.pair.update({
    where: { id: pair.id },
    data: { factoryAddress: factory, factoryCheckedAt: now },
  });

  const canonical = await getCanonicalFactoryAddress(pair.chain, pair.dex);
  const mismatch = !!factory && !!canonical && !addrEq(factory, canonical);

  // Only the case where we actually learned a factory can change the verdict.
  let verdict: TokenPairStatus | null = null;
  if (factory) {
    const out = await runVerdictForPair(pair.id, { now });
    verdict = out.result?.verdict ?? null;
  }

  return { checked: true, factoryFound: !!factory, mismatch, verdict };
}
