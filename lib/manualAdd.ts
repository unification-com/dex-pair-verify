// lib/manualAdd.ts
// Operator "manually add a pair / token" orchestration. Pure composition of the
// existing ingest + verification passes (DRY): nothing here re-implements pair
// hydration, the identity/canonical/factory/scam checks or the verdict — it just
// sequences the single-pair / single-token runners the pipeline already uses. So a
// manually added pair lands in exactly the same state as an auto-ingested one and
// is maintained by the normal pipeline thereafter. Paced GeckoTerminal / CoinGecko
// calls flow through the shared rate gate inside those runners.
//
// The API routes expose these as bounded units; the /add page loops + paces + shows
// progress (the same client-driven idiom as the ingest pass-runner).

import { utils as web3Utils } from "web3";

import { tokenContractsByChain } from "./canonical";
import { runCanonicalCheckForToken } from "./canonicalCheck";
import { runFactoryCheckForPair } from "./factoryCheck";
import { runIdentityCheckForToken } from "./identityCheck";
import { ingestPairByAddress, ingestTokenPools } from "./ingest";
import prisma from "./prisma";
import { runScamCheckForToken } from "./scamCheck";
import { getSources } from "./sourceConfig";
import { runVerdictForPair } from "./verdictRunner";

export type TokenSummary = {
  id: string;
  chain: string;
  contractAddress: string;
  symbol: string;
  coingeckoCoinId: string;
  identityConfirmed: boolean;
  isScamFlagged: boolean;
};

export type PairSummary = {
  pairId: string;
  chain: string;
  dex: string;
  pair: string;
  status: string;
  confidence: number | null;
  tokens: TokenSummary[];
};

const tokenSelect = {
  id: true,
  chain: true,
  contractAddress: true,
  symbol: true,
  coingeckoCoinId: true,
  identityConfirmed: true,
  isScamFlagged: true,
} as const;

const toTokenSummary = (t: TokenSummary): TokenSummary => ({
  id: t.id,
  chain: t.chain,
  contractAddress: t.contractAddress,
  symbol: t.symbol,
  coingeckoCoinId: t.coingeckoCoinId,
  identityConfirmed: t.identityConfirmed,
  isScamFlagged: t.isScamFlagged,
});

// The current DB state of a pair, shaped for the /add result list.
export async function pairSummary(pairId: string): Promise<PairSummary | null> {
  const p = await prisma.pair.findUnique({
    where: { id: pairId },
    select: {
      id: true,
      chain: true,
      dex: true,
      pair: true,
      status: true,
      confidence: true,
      token0: { select: tokenSelect },
      token1: { select: tokenSelect },
    },
  });
  if (!p) {
    return null;
  }
  return {
    pairId: p.id,
    chain: p.chain,
    dex: p.dex,
    pair: p.pair,
    status: p.status,
    confidence: p.confidence,
    tokens: [toTokenSummary(p.token0), toTokenSummary(p.token1)],
  };
}

// Run the full per-pair verification on an already-ingested pair: factory check +
// both tokens' identity / canonical / scam checks, then a final verdict. Each runner
// re-runs the verdict after it writes, so the last call is belt-and-braces. These are
// the same passes the batch pipeline runs — just scoped to one pair.
export async function enrichPair(pairId: string, opts: { now?: number } = {}): Promise<PairSummary | null> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const pair = await prisma.pair.findUnique({ where: { id: pairId }, select: { token0Id: true, token1Id: true } });
  if (!pair) {
    return null;
  }

  await runFactoryCheckForPair(pairId, { now });
  for (const tokenId of [pair.token0Id, pair.token1Id]) {
    await runIdentityCheckForToken(tokenId, { now });
    await runCanonicalCheckForToken(tokenId, { now });
    await runScamCheckForToken(tokenId, { now });
  }
  await runVerdictForPair(pairId, { now });

  return pairSummary(pairId);
}

// Add one pair by address: ingest it from GeckoTerminal (verdict runs inline). The
// caller follows up with enrichPair to run the verification passes. Returns ok:false
// with a reason the operator can act on (unknown pool / wrong DEX / incomplete data).
export async function addPair(
  chain: string,
  dex: string,
  address: string,
  opts: { now?: number } = {},
): Promise<{ ok: boolean; reason?: string; summary?: PairSummary }> {
  const res = await ingestPairByAddress(chain, dex, address, { now: opts.now });
  if (!res.ok) {
    return { ok: false, reason: res.reason };
  }
  const summary = await pairSummary(res.pairId);
  if (!summary) {
    return { ok: false, reason: "pair not found after ingest" };
  }
  return { ok: true, summary };
}

// Ingest every supported-DEX pool for a token on a chain, returning the ids of all
// pairs that now reference it (new + pre-existing) so the caller can enrich each.
export async function addToken(
  chain: string,
  address: string,
  opts: { now?: number } = {},
): Promise<{ ok: boolean; reason?: string; cgId?: string; pairIds?: string[]; ingested?: number; skipped?: number }> {
  let addr: string;
  try {
    addr = web3Utils.toChecksumAddress(address);
  } catch {
    return { ok: false, reason: `invalid token address: ${address}` };
  }
  const res = await ingestTokenPools(chain, addr, { now: opts.now });
  const pairIds = await pairIdsForToken(chain, addr);
  const cgId = await cgIdForToken(chain, addr);
  return { ok: true, cgId, pairIds, ingested: res.ingested, skipped: res.skipped };
}

// The supported chains (other than the token's own) where this coin also has a
// contract — the one-hop cross-chain spider targets. Empty when the token has no
// CoinGecko id (we can't resolve siblings without one).
export async function siblingsForToken(
  chain: string,
  address: string,
): Promise<{ cgId: string; siblings: { chain: string; address: string }[] }> {
  let addr: string;
  try {
    addr = web3Utils.toChecksumAddress(address);
  } catch {
    return { cgId: "", siblings: [] };
  }
  const cgId = await cgIdForToken(chain, addr);
  if (!cgId) {
    return { cgId: "", siblings: [] };
  }
  const supportedChains = new Set((await getSources()).map((s) => s.chain));
  const byChain = await tokenContractsByChain(cgId);
  const siblings: { chain: string; address: string }[] = [];
  for (const [c, a] of Object.entries(byChain)) {
    if (c !== chain && supportedChains.has(c)) {
      siblings.push({ chain: c, address: a });
    }
  }
  return { cgId, siblings };
}

async function pairIdsForToken(chain: string, address: string): Promise<string[]> {
  const pairs = await prisma.pair.findMany({
    where: {
      OR: [
        { token0: { chain, contractAddress: address } },
        { token1: { chain, contractAddress: address } },
      ],
    },
    select: { id: true },
  });
  return pairs.map((p) => p.id);
}

async function cgIdForToken(chain: string, address: string): Promise<string> {
  const t = await prisma.token.findFirst({ where: { chain, contractAddress: address }, select: { coingeckoCoinId: true } });
  return t?.coingeckoCoinId ?? "";
}
