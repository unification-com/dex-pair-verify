// Shared pipeline pass-runners. Each drains the existing batch helpers and
// returns a summary; reused by the per-pass CLIs (import/*.ts) AND the
// full-pipeline orchestrator (import/pipeline.ts) — one loop per pass (DRY).

import { countTokensToCanonicalCheck, runCanonicalCheckForToken, tokensToCanonicalCheck } from "./canonicalCheck";
import { isCosmosRegistryChain } from "./cosmosRegistry";
import { countPairsToFactoryCheck, pairsToFactoryCheck, runFactoryCheckForPair } from "./factoryCheck";
import { ingestableFirstParty } from "./firstParty";
import { countTokensToIdentityCheck, runIdentityCheckForToken, tokensToIdentityCheck } from "./identityCheck";
import { ingestPoolPage, ingestTokenPools } from "./ingest";
import prisma from "./prisma";
import { countTokensToReviewEnrich, tokensToReviewEnrich } from "./reviewEnrich";
import {
  countTokensToScamCheck,
  rescoreScamForToken,
  runScamCheckForToken,
  tokensToRescore,
  tokensToScamCheck,
} from "./scamCheck";
import { runSecurityScanForToken } from "./securitySignals";
import { getSources, gtDexFor, gtNetworkFor, isIngestableSource } from "./sourceConfig";
import { runVerdictForPair } from "./verdictRunner";

export type Logger = (msg: string) => void;
const noop: Logger = () => {};

// The database name from POSTGRES_PRISMA_URL, for log messages.
export const targetDb = (): string => {
  const url = process.env.POSTGRES_PRISMA_URL || "";
  const match = url.match(/\/([^/?]+)(\?|$)/);
  return match ? match[1] : "(unknown)";
};
const nowS = (): number => Math.floor(Date.now() / 1000);

// Re-check TTL lever (env PIPELINE_RECHECK_DAYS, default 7). The slow-moving
// batch passes (identity / canonical / factory / scam / review-enrich) skip
// tokens already checked within this window, instead of re-checking the whole
// fleet every run — so a FREQUENT pipeline doesn't keep re-spending CoinGecko /
// GoPlus quota on data that rarely changes. Passing `now - TTL` as the selection
// cutoff while still stamping with `now` preserves the drain-to-empty contract
// (a token stamped this run is > cutoff, so it drops out). Ingest (fresh market
// data) + revalidate (pure DB) always run in full. The on-demand UI pass-runners
// still force a full check (they pass `now`, not the cutoff). 0 = re-check all.
const RECHECK_TTL_S = Math.max(0, Number(process.env.PIPELINE_RECHECK_DAYS ?? 7)) * 86_400;
const recheckCutoff = (now: number): number => now - RECHECK_TTL_S;

// Drain a jobStartedAt-based batched pass: keep fetching ids and running
// `processOne` until empty. The helpers stamp each id as it's processed, so the
// batch shrinks to empty (no infinite loop — every pass stamps even on a miss).
async function drainBatches(
  getBatch: (batch: number) => Promise<string[]>,
  processOne: (id: string) => Promise<void>,
  batch: number,
  onProgress: (done: number) => void,
): Promise<number> {
  let done = 0;
  for (;;) {
    const ids = await getBatch(batch);
    if (ids.length === 0) {
      break;
    }
    for (const id of ids) {
      await processOne(id);
      done += 1;
    }
    onProgress(done);
  }
  return done;
}

// --- ingest ---------------------------------------------------------------

// Inter-page pacing is owned by the shared CoinGecko gate (lib/coingecko.ts):
// each page makes one keyed call through cgKeyedFetch, which spaces calls under
// the Demo key's per-minute window. No separate page delay needed here.

export type IngestSummary = { pairs: number; tallies: Record<string, number> };

export async function ingestAll(opts: { log?: Logger } = {}): Promise<IngestSummary> {
  const log = opts.log ?? noop;
  const tallies: Record<string, number> = {};
  let pairs = 0;

  const sources = await getSources();
  for (const s of sources) {
    if (!isIngestableSource(s)) {
      continue;
    }
    const lastPage = s.last_page ?? 10;
    // A Cosmos source ingests via SQS (subgraphUrlTemplate holds the SQS base URL); an EVM source via
    // GeckoTerminal (its network/dex slugs). The adapter is selected by chain inside ingestPoolPage.
    const ingestOpts = isCosmosRegistryChain(s.chain)
      ? { sqsUrl: s.subgraphUrlTemplate }
      : { gtNetwork: gtNetworkFor(s), gtDex: gtDexFor(s) };
    for (let page = 1; page <= lastPage; page += 1) {
      const res = await ingestPoolPage(s.chain, s.dex, page, ingestOpts);
      for (const [k, v] of Object.entries(res.tallies)) {
        tallies[k] = (tallies[k] ?? 0) + v;
      }
      pairs += res.pairs;
      log(`[ingest] ${s.chain}/${s.dex} p${page}: ${res.poolCount} pools, ${res.pairs} pairs`);
      if (!res.hadData) {
        break;
      }
    }
  }

  // Targeted first-party pull — guarantee our own tokens' pools are in (the
  // page ingest above only takes top-ranked pools per DEX, so it misses them).
  const fp = await firstPartyIngestPass({ log });
  for (const [k, v] of Object.entries(fp.tallies)) {
    tallies[k] = (tallies[k] ?? 0) + v;
  }
  pairs += fp.pools;

  return { pairs, tallies };
}

export type FirstPartySummary = { pools: number; tallies: Record<string, number> };

// Pull EVERY pool for our first-party tokens (FUND/xFUND/FUNDx) on the chains we
// ingest, so they're never missed by the page-based ingest. Reused by ingestAll
// and the standalone `yarn first-party` CLI.
export async function firstPartyIngestPass(opts: { log?: Logger } = {}): Promise<FirstPartySummary> {
  const log = opts.log ?? noop;
  const tallies: Record<string, number> = {};
  let pools = 0;
  for (const t of ingestableFirstParty()) {
    const r = await ingestTokenPools(t.chain, t.address);
    for (const [k, v] of Object.entries(r.tallies)) {
      tallies[k] = (tallies[k] ?? 0) + v;
    }
    pools += r.ingested;
    log(`[first-party] ${t.symbol} ${t.chain}: ${r.ingested} pools ingested · ${r.skipped} skipped (unsupported DEX)`);
  }
  return { pools, tallies };
}

// --- enrichment passes ----------------------------------------------------

const BATCH = 25;

export type IdentitySummary = { total: number; confirmed: number; promoted: number };
export async function identityPass(opts: { log?: Logger } = {}): Promise<IdentitySummary> {
  const log = opts.log ?? noop;
  const now = nowS();
  const cutoff = recheckCutoff(now);
  const total = await countTokensToIdentityCheck(cutoff);
  let confirmed = 0;
  let promoted = 0;
  await drainBatches(
    (b) => tokensToIdentityCheck(cutoff, b),
    async (id) => {
      const out = await runIdentityCheckForToken(id, { now });
      if (out.confirmed) confirmed += 1;
      promoted += out.promotedPairs;
    },
    BATCH,
    (done) => log(`[identity] …${done}/${total} · ${confirmed} confirmed · ${promoted} promoted`),
  );
  return { total, confirmed, promoted };
}

export type CanonicalSummary = { total: number; resolved: number; impostorPairs: number };
export async function canonicalPass(opts: { log?: Logger } = {}): Promise<CanonicalSummary> {
  const log = opts.log ?? noop;
  const now = nowS();
  const cutoff = recheckCutoff(now);
  const total = await countTokensToCanonicalCheck(cutoff);
  let resolved = 0;
  let impostorPairs = 0;
  await drainBatches(
    (b) => tokensToCanonicalCheck(cutoff, b),
    async (id) => {
      const out = await runCanonicalCheckForToken(id, { now });
      if (out.hasAddress) resolved += 1;
      impostorPairs += out.impostorPairs;
    },
    BATCH,
    (done) => log(`[canonical] …${done}/${total} · ${resolved} resolved · ${impostorPairs} impostor pairs`),
  );
  return { total, resolved, impostorPairs };
}

export type FactorySummary = { total: number; read: number; mismatches: number };
export async function factoryPass(opts: { log?: Logger } = {}): Promise<FactorySummary> {
  const log = opts.log ?? noop;
  const now = nowS();
  const cutoff = recheckCutoff(now);
  const total = await countPairsToFactoryCheck(cutoff);
  let read = 0;
  let mismatches = 0;
  await drainBatches(
    (b) => pairsToFactoryCheck(cutoff, b),
    async (id) => {
      const out = await runFactoryCheckForPair(id, { now });
      if (out.factoryFound) read += 1;
      if (out.mismatch) mismatches += 1;
    },
    BATCH,
    (done) => log(`[factory] …${done}/${total} · ${read} read · ${mismatches} mismatches`),
  );
  return { total, read, mismatches };
}

export type ScamSummary = { total: number; flagged: number; demoted: number };
export async function scamPass(opts: { log?: Logger } = {}): Promise<ScamSummary> {
  const log = opts.log ?? noop;
  const now = nowS();
  const cutoff = recheckCutoff(now);
  const total = await countTokensToScamCheck(cutoff);
  let flagged = 0;
  let demoted = 0;
  await drainBatches(
    (b) => tokensToScamCheck(cutoff, b),
    async (id) => {
      const out = await runScamCheckForToken(id, { now });
      if (out.flagged) flagged += 1;
      demoted += out.demotedPairs;
    },
    BATCH,
    (done) => log(`[scam] …${done}/${total} · ${flagged} flagged · ${demoted} demoted`),
  );
  return { total, flagged, demoted };
}

export type RescoreScamSummary = { total: number; changed: number; nowFlagged: number; cleared: number };
// Re-score every scam-checked token's CACHED GoPlus data against the current
// rule (no GoPlus calls) and re-verify any whose flag flipped. The fast,
// quota-free way to apply a scam-signal rule change to existing data — contrast
// scamPass, which re-fetches GoPlus.
export async function rescoreScamPass(opts: { log?: Logger } = {}): Promise<RescoreScamSummary> {
  const log = opts.log ?? noop;
  const now = nowS();
  const ids = await tokensToRescore();
  let changed = 0;
  let nowFlagged = 0;
  let cleared = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const out = await rescoreScamForToken(ids[i], { now });
    if (out.changed) {
      changed += 1;
      if (out.flagged) {
        nowFlagged += 1;
      } else {
        cleared += 1;
      }
    }
    if ((i + 1) % 200 === 0) {
      log(`[rescore-scam] …${i + 1}/${ids.length} · ${changed} flags changed`);
    }
  }
  return { total: ids.length, changed, nowFlagged, cleared };
}

// Review-queue enrichment (B5). Pre-runs the on-demand enrichers (GoPlus +
// Honeypot.is + source-verified + web presence) over the tokens in NeedsReview
// pairs so the queue arrives pre-scanned. Heavier per token (≈4 external calls,
// GoPlus-paced), so it's a DELIBERATE pass — not part of the default orchestrator
// — kept bounded by being manually invoked + resumable via securityCheckedAt.
export type ReviewEnrichSummary = { total: number; scanned: number; flagged: number };
export async function reviewEnrichPass(opts: { log?: Logger } = {}): Promise<ReviewEnrichSummary> {
  const log = opts.log ?? noop;
  const now = nowS();
  const cutoff = recheckCutoff(now);
  const total = await countTokensToReviewEnrich(cutoff);
  let scanned = 0;
  let flagged = 0;
  await drainBatches(
    (b) => tokensToReviewEnrich(cutoff, b),
    async (id) => {
      const out = await runSecurityScanForToken(id, { now });
      if (out.ok) scanned += 1;
      if (out.scam?.flagged) flagged += 1;
    },
    BATCH,
    (done) => log(`[review-enrich] …${done}/${total} · ${flagged} scam-flagged`),
  );
  return { total, scanned, flagged };
}

export type RevalidateSummary = { count: number; tallies: Record<string, number> };
export async function revalidatePass(opts: { log?: Logger } = {}): Promise<RevalidateSummary> {
  const log = opts.log ?? noop;
  const now = nowS();
  const pairs = await prisma.pair.findMany({ select: { id: true } });
  const tallies: Record<string, number> = {};
  let done = 0;
  for (const p of pairs) {
    const out = await runVerdictForPair(p.id, { now });
    const key = out.skippedManual ? "skippedManual" : out.result?.verdict ?? "error";
    tallies[key] = (tallies[key] ?? 0) + 1;
    done += 1;
    if (done % 200 === 0) {
      log(`[revalidate] …${done}/${pairs.length}`);
    }
  }
  return { count: pairs.length, tallies };
}
