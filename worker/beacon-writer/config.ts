// worker/beacon-writer/config.ts
// Config for the standalone BEACON-writer worker (#130 S2). Read from the environment; the funded key
// is loaded from a FILE path (never an env literal) so it stays off the Next.js app surface entirely
// (per the security audit). Local devnet defaults match beacon-extensions/devnet_local.sh.
import { readFileSync } from "fs";

export type BeaconWriterConfig = {
  rpc: string; // CometBFT RPC (http) the SigningStargateClient connects to
  chainId: string;
  mnemonic: string; // the funded beacon-writer key (loaded from a file)
  beaconId: number; // 0 = not registered yet (run the `register` subcommand once)
  intervalSec: number; // heartbeat cadence
  recordFee: string; // nund — must cover the beacon module fee_record
  registerFee: string; // nund — must cover fee_register
  gas: string;
  moniker: string; // used by the one-off `register` subcommand
  name: string;
};

const env = (key: string, fallback?: string): string => {
  const v = process.env[key];
  if (v === undefined || v === "") {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`beacon-writer: missing required env ${key}`);
  }
  return v;
};

export function loadConfig(): BeaconWriterConfig {
  const mnemonic = readFileSync(env("BEACON_WRITER_MNEMONIC_FILE"), "utf8").trim();
  return {
    rpc: env("BEACON_RPC", "http://127.0.0.1:16657"),
    chainId: env("BEACON_CHAIN_ID", "FUND-DevNet"),
    mnemonic,
    beaconId: parseInt(env("BEACON_ID", "0"), 10),
    intervalSec: parseInt(env("BEACON_INTERVAL_SEC", "60"), 10),
    recordFee: env("BEACON_RECORD_FEE", "1000000000"), // 1 FUND
    registerFee: env("BEACON_REGISTER_FEE", "1000000000000"), // 1000 FUND
    gas: env("BEACON_GAS", "200000"),
    moniker: env("BEACON_MONIKER", "dpv-anchor"),
    name: env("BEACON_NAME", "dex-pair-verify anchor"),
  };
}

// A cosmos StdFee (the fee must cover the beacon module's record/register fee, not just gas).
export const stdFee = (amount: string, gas: string, denom = "nund") => ({ amount: [{ denom, amount }], gas });
