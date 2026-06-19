// worker/beacon-writer/index.ts
// The standalone BEACON-writer worker (#130). A SEPARATE process from the Next.js app (it holds the funded
// signing key — never put that in the web app, per the security audit). Two on-chain streams to a dpv-owned
// beacon:
//   - HEARTBEAT (~60s): record the current pair-tree + token-tree Merkle ROOTS (integrity + liveness).
//   - LEAF DRIP (one per ~block): record each verified pair/token LEAF hash individually, so every item gets
//     a direct on-chain timestamp — backfilling the set slowly, then only new/changed leaves (delta).
// All sends are serialised through one loop (one account ⇒ serial sequence): ≤1 tx/tick, a 2-tx burst once
// per heartbeat.
//
//   tsx worker/beacon-writer/index.ts register     # one-off: register the beacon, prints BEACON_ID
//   tsx worker/beacon-writer/index.ts once          # a single heartbeat (records both roots) then exit
//   tsx worker/beacon-writer/index.ts drip [N]      # drip up to N pending leaves (default 1) then exit
//   tsx worker/beacon-writer/index.ts               # the heartbeat + drip loop
import "../../lib/env"; // load .env (POSTGRES_PRISMA_URL etc.) before prisma is imported

import { BeaconSigner, chainSupportsMetadata, connectBeaconSigner, disconnect, recordTimestamp, registerBeacon } from "./chain";
import { BeaconWriterConfig, loadConfig, stdFee } from "./config";
import { AnchorSnapshot, getAnchorSnapshot, getTokenAnchorSnapshot } from "../../lib/anchor";
import { getChainState, markMetadataLive, markReanchorSeeded } from "../../lib/beaconChainState";
import { enqueueLeaves, markAnchored, nextPending, queueStats, seedReanchorBacklog } from "../../lib/beaconQueue";
import prisma from "../../lib/prisma";

const log = (msg: string): void => console.log(`[beacon-writer ${new Date().toISOString()}] ${msg}`);
const nowSeconds = (): number => Math.floor(Date.now() / 1000);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Last anchored root per tree, so a re-stamp between changes is flagged changed=0.
type BeatState = { pairs: string; tokens: string };
type Tree = "pairs" | "tokens";

// #129 roll-out: false until the vaxildan upgrade is detected, then latched on for this process so every
// record carries its on-chain metadata descriptor. Pre-detection we record metadata-less (wire-identical to
// a v0.2.0 client) so the old chain accepts the txs. Sticky in the DB too (BeaconChainState).
let metadataLive = false;

// Probe + latch the upgrade. Once metadata goes live, seed the one-time re-anchor backlog (every pre-upgrade
// anchor re-queued to be re-recorded WITH metadata — the only way they reach the forward-only hash index).
// Cheap to call each heartbeat: a no-op once latched, a single read-only abci_query while still pending.
async function ensureMetadata(cfg: BeaconWriterConfig): Promise<void> {
  if (metadataLive) {
    return;
  }
  let st = await getChainState();
  if (!st.metadataLive) {
    if (!(await chainSupportsMetadata(cfg.rpc, cfg.beaconId))) {
      return; // upgrade not applied yet — keep recording metadata-less
    }
    await markMetadataLive(nowSeconds());
    st = await getChainState();
    log("vaxildan upgrade detected (BeaconTimestampsByHash served) — metadata is now LIVE");
  }
  metadataLive = true;
  if (cfg.reanchorEnabled && !st.reanchorSeeded) {
    const n = await seedReanchorBacklog(nowSeconds());
    await markReanchorSeeded();
    log(`re-anchor backlog seeded: ${n} pre-upgrade records queued to re-record WITH metadata`);
  }
}

// Record one tree's ROOT on-chain + persist the anchor row. Returns the root just anchored (for the state).
async function recordTree(s: BeaconSigner, cfg: BeaconWriterConfig, tree: Tree, snap: AnchorSnapshot, lastRoot: string): Promise<string> {
  if (!snap.root) {
    log(`${tree}: empty set — skipping`);
    return lastRoot;
  }
  const changed = snap.root === lastRoot ? 0 : 1;
  const metadata = `tree=${tree};schema=v3;leaves=${snap.leafCount};changed=${changed}`;
  const submitTime = nowSeconds();
  // Always store the descriptor off-chain; only put it ON-chain once the upgrade is live (else "" ⇒ omitted).
  const r = await recordTimestamp(s, cfg.beaconId, snap.root, submitTime, stdFee(cfg.recordFee, cfg.gas), metadataLive ? metadata : "");
  await prisma.beaconAnchor.create({
    data: { beaconId: cfg.beaconId, timestampId: r.timestampId, tree, txHash: r.txHash, root: snap.root, leafCount: snap.leafCount, metadata, submitTime, createdAt: submitTime },
  });
  log(`beat[${tree}]: root=${snap.root.slice(0, 16)}… leaves=${snap.leafCount} changed=${changed} ts=${r.timestampId} tx=${r.txHash}`);
  return snap.root;
}

// One heartbeat: anchor BOTH roots, then (if drip is on) enqueue any new/changed leaves for the drip.
async function heartbeat(s: BeaconSigner, cfg: BeaconWriterConfig, state: BeatState): Promise<void> {
  const pairs = await getAnchorSnapshot();
  const tokens = await getTokenAnchorSnapshot();
  state.pairs = await recordTree(s, cfg, "pairs", pairs, state.pairs);
  state.tokens = await recordTree(s, cfg, "tokens", tokens, state.tokens);
  if (cfg.dripEnabled) {
    const now = nowSeconds();
    const np = await enqueueLeaves("pairs", pairs.leaves, pairs.root, now);
    const nt = await enqueueLeaves("tokens", tokens.leaves, tokens.root, now);
    if (np + nt > 0) {
      const st = await queueStats();
      log(`enqueued ${np} new pair + ${nt} new token leaves (pending ${st.pending}, anchored ${st.anchored})`);
    }
  }
}

// Drip ONE pending item (a pair/token leaf or a fulfilment receipt) on-chain. False when the backlog drains.
async function dripOne(s: BeaconSigner, cfg: BeaconWriterConfig): Promise<boolean> {
  const item = await nextPending();
  if (!item) {
    return false;
  }
  const submitTime = nowSeconds();
  // A queue row (leaf / fulfilment / reanchor) carries its descriptor in `metadata`; put it on-chain once live.
  const r = await recordTimestamp(s, cfg.beaconId, item.hash, submitTime, stdFee(cfg.recordFee, cfg.gas), metadataLive ? item.metadata : "");
  await markAnchored(item.id, r.timestampId, r.txHash, submitTime);
  log(`drip[${item.stream}] ${item.refKey} hash=${item.hash.slice(0, 12)}… ts=${r.timestampId} tx=${r.txHash}`);
  return true;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const mode = process.argv[2] ?? "";
  const s = await connectBeaconSigner(cfg.rpc, cfg.mnemonic);
  log(`connected rpc=${cfg.rpc} chain=${cfg.chainId} signer=${s.address}`);

  if (mode === "register") {
    const { beaconId, txHash } = await registerBeacon(s, cfg.moniker, cfg.name, stdFee(cfg.registerFee, cfg.gas));
    log(`registered beacon_id=${beaconId} tx=${txHash} — set BEACON_ID=${beaconId} in the worker env`);
    disconnect(s);
    return;
  }

  if (!cfg.beaconId) {
    throw new Error("BEACON_ID not set — run the `register` subcommand once, then set BEACON_ID");
  }

  // Seed each tree's last root from the most recent stored anchor so a restart doesn't false-flag changed=1.
  const lastOf = async (tree: Tree): Promise<string> =>
    (await prisma.beaconAnchor.findFirst({ where: { beaconId: cfg.beaconId, tree }, orderBy: { submitTime: "desc" } }))?.root ?? "";
  const state: BeatState = { pairs: await lastOf("pairs"), tokens: await lastOf("tokens") };

  if (mode === "once") {
    await ensureMetadata(cfg);
    await heartbeat(s, cfg, state);
    disconnect(s);
    return;
  }

  if (mode === "drip") {
    await ensureMetadata(cfg);
    const n = Math.max(1, parseInt(process.argv[3] ?? "1", 10) || 1);
    let done = 0;
    for (let i = 0; i < n; i += 1) {
      if (!(await dripOne(s, cfg))) {
        break;
      }
      done += 1;
    }
    log(`dripped ${done} leaf/leaves`);
    disconnect(s);
    return;
  }

  log(`heartbeat every ${cfg.intervalSec}s; drip ${cfg.dripEnabled ? "on (serial, ~1 tx/block)" : "off"} on beacon ${cfg.beaconId}`);
  let stopped = false;
  const stop = (sig: string): void => {
    stopped = true; // the loop finishes the in-flight tx, then exits cleanly
    log(`received ${sig} — stopping after the current tx`);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  // SERIAL loop: exactly ONE tx is ever in flight. Each record awaits inclusion before the next begins, so
  // cosmjs always signs with a fresh account sequence — this removes the "account sequence mismatch" races the
  // previous overlapping setInterval caused (a heartbeat's two txs outran the tick interval, so ticks stacked).
  // Each signAndBroadcast already blocks ~one block, so the drip self-paces at ~1 tx/block at full throughput.
  let nextHeartbeat = 0; // fire a heartbeat immediately
  while (!stopped) {
    try {
      if (Date.now() >= nextHeartbeat) {
        await ensureMetadata(cfg); // probe for the upgrade once per heartbeat until it latches on
        await heartbeat(s, cfg, state);
        nextHeartbeat = Date.now() + cfg.intervalSec * 1000;
      } else if (!cfg.dripEnabled || !(await dripOne(s, cfg))) {
        // drip off, or the backlog is drained: idle in short hops until the next heartbeat (stays responsive
        // to SIGTERM + the heartbeat schedule without busy-spinning).
        await sleep(Math.min(2000, Math.max(250, nextHeartbeat - Date.now())));
      }
    } catch (e) {
      // Non-fatal (e.g. a transient RPC blip): log + back off ~a block, then retry on the next iteration.
      log(`record error (will retry): ${(e as Error).message}`);
      await sleep(cfg.dripIntervalSec * 1000);
    }
  }
  disconnect(s);
  log("stopped");
  process.exit(0);
}

main().catch((e) => {
  console.error(`[beacon-writer] fatal: ${(e as Error).message}`);
  process.exit(1);
});
