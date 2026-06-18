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

import { BeaconSigner, connectBeaconSigner, disconnect, recordTimestamp, registerBeacon } from "./chain";
import { BeaconWriterConfig, loadConfig, stdFee } from "./config";
import { AnchorSnapshot, getAnchorSnapshot, getTokenAnchorSnapshot } from "../../lib/anchor";
import { enqueueLeaves, markAnchored, nextPending, queueStats } from "../../lib/beaconQueue";
import prisma from "../../lib/prisma";

const log = (msg: string): void => console.log(`[beacon-writer ${new Date().toISOString()}] ${msg}`);
const nowSeconds = (): number => Math.floor(Date.now() / 1000);

// Last anchored root per tree, so a re-stamp between changes is flagged changed=0.
type BeatState = { pairs: string; tokens: string };
type Tree = "pairs" | "tokens";

// Record one tree's ROOT on-chain + persist the anchor row. Returns the root just anchored (for the state).
async function recordTree(s: BeaconSigner, cfg: BeaconWriterConfig, tree: Tree, snap: AnchorSnapshot, lastRoot: string): Promise<string> {
  if (!snap.root) {
    log(`${tree}: empty set — skipping`);
    return lastRoot;
  }
  const changed = snap.root === lastRoot ? 0 : 1;
  const metadata = `tree=${tree};schema=v3;leaves=${snap.leafCount};changed=${changed}`;
  const submitTime = nowSeconds();
  const r = await recordTimestamp(s, cfg.beaconId, snap.root, submitTime, stdFee(cfg.recordFee, cfg.gas));
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
  const r = await recordTimestamp(s, cfg.beaconId, item.hash, submitTime, stdFee(cfg.recordFee, cfg.gas));
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
    await heartbeat(s, cfg, state);
    disconnect(s);
    return;
  }

  if (mode === "drip") {
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

  log(`heartbeat every ${cfg.intervalSec}s; drip ${cfg.dripEnabled ? `every ${cfg.dripIntervalSec}s` : "off"} on beacon ${cfg.beaconId}`);
  let nextHeartbeat = 0; // fire a heartbeat immediately
  const tickMs = (cfg.dripEnabled ? cfg.dripIntervalSec : cfg.intervalSec) * 1000;
  const tick = async (): Promise<void> => {
    try {
      if (Date.now() >= nextHeartbeat) {
        await heartbeat(s, cfg, state);
        nextHeartbeat = Date.now() + cfg.intervalSec * 1000;
      } else if (cfg.dripEnabled) {
        await dripOne(s, cfg);
      }
    } catch (e) {
      // Non-fatal: the heartbeat IS the liveness alarm — log + let the next tick retry.
      log(`tick error (will retry next tick): ${(e as Error).message}`);
    }
  };
  await tick(); // immediate first heartbeat
  const timer = setInterval(() => void tick(), tickMs);

  const stop = (sig: string): void => {
    clearInterval(timer);
    disconnect(s);
    log(`received ${sig} — stopped`);
    process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

main().catch((e) => {
  console.error(`[beacon-writer] fatal: ${(e as Error).message}`);
  process.exit(1);
});
