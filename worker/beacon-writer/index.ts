// worker/beacon-writer/index.ts
// The standalone BEACON-writer worker (#130 S2). A SEPARATE process from the Next.js app (it holds the
// funded signing key — never put that in the web app, per the security audit). Every ~60s it takes the
// current verified-set Merkle root (lib/anchor) and records it to a dpv-owned beacon on mainchain, then
// stores the anchor row for the page badges (#130 S3). Between verdict changes it re-stamps the same root
// — a FUND-secured liveness + freshness + integrity heartbeat (the decommissioned Finchains cadence).
//
//   tsx worker/beacon-writer/index.ts register   # one-off: register the beacon, prints BEACON_ID
//   tsx worker/beacon-writer/index.ts once        # a single beat (for testing) then exit
//   tsx worker/beacon-writer/index.ts             # the heartbeat loop
import "../../lib/env"; // load .env (POSTGRES_PRISMA_URL etc.) before prisma is imported

import { BeaconSigner, connectBeaconSigner, disconnect, recordTimestamp, registerBeacon } from "./chain";
import { BeaconWriterConfig, loadConfig, stdFee } from "./config";
import { getAnchorSnapshot } from "../../lib/anchor";
import prisma from "../../lib/prisma";

const log = (msg: string): void => console.log(`[beacon-writer ${new Date().toISOString()}] ${msg}`);

type BeatState = { lastRoot: string };

// One heartbeat: snapshot the root → record it on-chain → persist the anchor row.
async function beat(s: BeaconSigner, cfg: BeaconWriterConfig, state: BeatState): Promise<void> {
  const snap = await getAnchorSnapshot();
  if (!snap.root) {
    log("no verified pairs in the set — skipping this beat");
    return;
  }
  const changed = snap.root === state.lastRoot ? 0 : 1;
  const metadata = `schema=v3;pairs=${snap.leafCount};changed=${changed}`;
  const submitTime = Math.floor(Date.now() / 1000);

  const r = await recordTimestamp(s, cfg.beaconId, snap.root, submitTime, stdFee(cfg.recordFee, cfg.gas));

  await prisma.beaconAnchor.create({
    data: {
      beaconId: cfg.beaconId,
      timestampId: r.timestampId,
      txHash: r.txHash,
      root: snap.root,
      leafCount: snap.leafCount,
      metadata,
      submitTime,
      createdAt: submitTime,
    },
  });
  state.lastRoot = snap.root;
  log(`beat: root=${snap.root.slice(0, 16)}… pairs=${snap.leafCount} changed=${changed} ts=${r.timestampId} tx=${r.txHash}`);
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

  // Seed lastRoot from the most recent stored anchor so a restart doesn't false-flag changed=1.
  const last = await prisma.beaconAnchor.findFirst({ where: { beaconId: cfg.beaconId }, orderBy: { submitTime: "desc" } });
  const state: BeatState = { lastRoot: last?.root ?? "" };

  if (mode === "once") {
    await beat(s, cfg, state);
    disconnect(s);
    return;
  }

  log(`heartbeat every ${cfg.intervalSec}s on beacon ${cfg.beaconId}`);
  const tick = async (): Promise<void> => {
    try {
      await beat(s, cfg, state);
    } catch (e) {
      // Non-fatal: the heartbeat IS the liveness alarm — log + let the next tick retry.
      log(`beat error (will retry next tick): ${(e as Error).message}`);
    }
  };
  await tick(); // immediate first beat
  const timer = setInterval(() => void tick(), cfg.intervalSec * 1000);

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
