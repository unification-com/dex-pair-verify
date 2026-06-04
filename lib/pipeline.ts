// Shared pipeline pass-runners. Each drains the existing batch helpers and
// returns a summary; reused by the per-pass CLIs (import/*.ts) AND the
// full-pipeline orchestrator (import/pipeline.ts) — one loop per pass (DRY).

import { countTokensToCanonicalCheck, runCanonicalCheckForToken, tokensToCanonicalCheck } from "./canonicalCheck";
import { countPairsToFactoryCheck, pairsToFactoryCheck, runFactoryCheckForPair } from "./factoryCheck";
import { countTokensToIdentityCheck, runIdentityCheckForToken, tokensToIdentityCheck } from "./identityCheck";
import { ingestPoolPage } from "./ingest";
import prisma from "./prisma";
import { countTokensToScamCheck, runScamCheckForToken, tokensToScamCheck } from "./scamCheck";
import { getSourceByIndex, gtDexFor, gtNetworkFor, sourceCount } from "./sourceConfig";
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

  for (let i = 0; i < sourceCount; i += 1) {
    const s = getSourceByIndex(i);
    if (!s || s.onCoinGeckoTerminal === false) {
      continue;
    }
    const lastPage = s.last_page ?? 10;
    for (let page = 1; page <= lastPage; page += 1) {
      const res = await ingestPoolPage(s.chain, s.dex, page, { gtNetwork: gtNetworkFor(s), gtDex: gtDexFor(s) });
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
  return { pairs, tallies };
}

// --- enrichment passes ----------------------------------------------------

const BATCH = 25;

export type IdentitySummary = { total: number; confirmed: number; promoted: number };
export async function identityPass(opts: { log?: Logger } = {}): Promise<IdentitySummary> {
  const log = opts.log ?? noop;
  const now = nowS();
  const total = await countTokensToIdentityCheck(now);
  let confirmed = 0;
  let promoted = 0;
  await drainBatches(
    (b) => tokensToIdentityCheck(now, b),
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
  const total = await countTokensToCanonicalCheck(now);
  let resolved = 0;
  let impostorPairs = 0;
  await drainBatches(
    (b) => tokensToCanonicalCheck(now, b),
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
  const total = await countPairsToFactoryCheck(now);
  let read = 0;
  let mismatches = 0;
  await drainBatches(
    (b) => pairsToFactoryCheck(now, b),
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
  const total = await countTokensToScamCheck(now);
  let flagged = 0;
  let demoted = 0;
  await drainBatches(
    (b) => tokensToScamCheck(now, b),
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
