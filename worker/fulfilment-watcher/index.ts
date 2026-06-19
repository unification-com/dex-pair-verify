// worker/fulfilment-watcher/index.ts
// The OoO fulfilment watcher (#130 path ii). A SEPARATE, READ-ONLY process (no signing key): it watches
// each OoO Router's `RequestFulfilled` event across every configured EVM network and enqueues a receipt
// hash into the shared BEACON queue (lib/beaconQueue). The single beacon-writer drains the queue and
// records each receipt on-chain one tx per block — so dpv anchors every OoO fulfilment with one funded key.
//
// Multiple networks ⇒ multiple watch loops in this one process (each its own RPC + block cursor), all
// feeding the one queue. Reuses the provider-auth Router config (lib/oooRouters) — env-overridable.
//
//   tsx worker/fulfilment-watcher/index.ts once   # one scan pass over every chain, then exit (testing)
//   tsx worker/fulfilment-watcher/index.ts        # the continuous watch loop
import "../../lib/env";

import { decodeDataRequested, decodeFulfilment, EvmLog, receiptCommit, DATA_REQUESTED_TOPIC, REQUEST_FULFILLED_TOPIC } from "./receipt";
import { enqueueFulfilments, getCursor, setCursor } from "../../lib/beaconQueue";
import { upsertFulfilment, upsertRequest } from "../../lib/fulfilments";
import { builtInOooChainIds, oooRouterForChain } from "../../lib/oooRouters";

const log = (msg: string): void => console.log(`[fulfilment-watcher ${new Date().toISOString()}] ${msg}`);
const nowSeconds = (): number => Math.floor(Date.now() / 1000);

type WatchConfig = {
  chainIds: number[];
  intervalSec: number; // poll cadence
  batchBlocks: number; // max blocks per scan (RPC getLogs range cap)
  confirmations: number; // stay this far behind head (reorg safety)
  startBlock: (chainId: number) => number | undefined; // first-run start block per chain (else near head)
};

const intEnv = (key: string, dflt: number): number => {
  const v = parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(v) ? v : dflt;
};

function loadWatchConfig(): WatchConfig {
  const csv = (process.env.BEACON_WATCH_CHAINS ?? "").split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
  return {
    chainIds: csv.length ? csv : builtInOooChainIds(),
    intervalSec: intEnv("BEACON_WATCH_INTERVAL_SEC", 30),
    batchBlocks: intEnv("BEACON_WATCH_BATCH_BLOCKS", 5000),
    confirmations: intEnv("BEACON_WATCH_CONFIRMATIONS", 5),
    startBlock: (chainId) => {
      const v = parseInt(process.env[`BEACON_WATCH_START_BLOCK_${chainId}`] ?? "", 10);
      return Number.isFinite(v) ? v : undefined;
    },
  };
}

// --- raw JSON-RPC (dpv uses web3 not ethers; a thin fetch is enough + dependency-light) ---------------
async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json?.error) {
    throw new Error(`${method}: ${json.error.message ?? JSON.stringify(json.error)}`);
  }
  return json.result;
}

const getBlockNumber = async (url: string): Promise<number> => parseInt((await rpc(url, "eth_blockNumber", [])) as string, 16);

// topic0 = (RequestFulfilled OR DataRequested) — one getLogs call returns both the fulfil side (for anchoring
// + result) and the request side (for pair + fee), joined later by requestId.
const getLogs = async (url: string, address: string, fromBlock: number, toBlock: number): Promise<EvmLog[]> =>
  (await rpc(url, "eth_getLogs", [{ address, fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${toBlock.toString(16)}`, topics: [[REQUEST_FULFILLED_TOPIC, DATA_REQUESTED_TOPIC]] }])) as EvmLog[];

// Block unix time, for requestedAt / fulfilledAt. Called once per distinct block that carries an event.
const getBlockTime = async (url: string, blockNumber: number): Promise<number | null> => {
  const blk = (await rpc(url, "eth_getBlockByNumber", [`0x${blockNumber.toString(16)}`, false])) as { timestamp: string } | null;
  return blk?.timestamp ? parseInt(blk.timestamp, 16) : null;
};

// Scan one chain from its cursor and enqueue any new fulfilment receipts. Returns blocks/fulfilments scanned.
async function scanChain(chainId: number, cfg: WatchConfig): Promise<{ logs: number; enqueued: number } | null> {
  const router = oooRouterForChain(chainId);
  if (!router) {
    log(`chain ${chainId}: no Router config (set OOO_ROUTER_RPC_${chainId} + OOO_ROUTER_ADDRESS_${chainId}) — skipping`);
    return null;
  }
  const head = await getBlockNumber(router.rpc);
  const safe = head - cfg.confirmations;
  let cursor = await getCursor(chainId);
  if (cursor === 0) {
    cursor = (cfg.startBlock(chainId) ?? safe) - 1; // first run: backfill from a configured block, else only new
  }
  const from = cursor + 1;
  if (from > safe) {
    return { logs: 0, enqueued: 0 }; // nothing new yet
  }
  const to = Math.min(safe, cursor + cfg.batchBlocks);
  const logs = await getLogs(router.rpc, router.router, from, to);
  const now = nowSeconds();
  const ctx = { chain: router.name, chainId };

  // Resolve block times once per distinct block that carries an event (OoO events are sparse → cheap).
  const blockTimes = new Map<number, number | null>();
  for (const l of logs) {
    const bn = parseInt(l.blockNumber, 16);
    if (!blockTimes.has(bn)) blockTimes.set(bn, await getBlockTime(router.rpc, bn));
  }

  const requests = logs.map((l) => decodeDataRequested(l, ctx)).filter((d): d is NonNullable<typeof d> => d !== null);
  const fulfilments = logs.map((l) => decodeFulfilment(l, ctx)).filter((f): f is NonNullable<typeof f> => f !== null);

  // Fulfilment history (admin #1): request + fulfil sides upserted independently, keyed by requestId.
  for (const r of requests) await upsertRequest(r, blockTimes.get(r.blockNumber) ?? null, now);
  for (const f of fulfilments) await upsertFulfilment(f, blockTimes.get(f.blockNumber) ?? null, now);

  // Anchor each fulfilment receipt on BEACON (unchanged path).
  const enqueued = await enqueueFulfilments(fulfilments.map(receiptCommit), now);
  await setCursor(chainId, to, now);
  if (logs.length > 0) {
    log(`scan[${router.name}] blocks ${from}-${to}: ${requests.length} requests, ${fulfilments.length} fulfilments, ${enqueued} new enqueued (cursor→${to}/${head})`);
  }
  return { logs: logs.length, enqueued };
}

async function scanAll(cfg: WatchConfig): Promise<void> {
  for (const chainId of cfg.chainIds) {
    try {
      await scanChain(chainId, cfg);
    } catch (e) {
      log(`scan chain ${chainId} error (will retry): ${(e as Error).message}`);
    }
  }
}

async function main(): Promise<void> {
  const cfg = loadWatchConfig();
  const mode = process.argv[2] ?? "";
  log(`watching chains [${cfg.chainIds.join(", ")}] every ${cfg.intervalSec}s (batch ${cfg.batchBlocks}, ${cfg.confirmations} confs)`);

  if (mode === "once") {
    await scanAll(cfg);
    return;
  }

  await scanAll(cfg);
  const timer = setInterval(() => void scanAll(cfg), cfg.intervalSec * 1000);
  const stop = (sig: string): void => {
    clearInterval(timer);
    log(`received ${sig} — stopped`);
    process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

main().catch((e) => {
  console.error(`[fulfilment-watcher] fatal: ${(e as Error).message}`);
  process.exit(1);
});
