// worker/beacon-writer/chain.ts
// The mainchain signing layer for the BEACON writer (#130 S2): a fundjs (telescope-2.x) + cosmjs
// SigningStargateClient that registers a beacon and records timestamp hashes. Mirrors the canonical
// signing pattern in fundjs-examples (DirectSecp256k1HdWallet with the `und` prefix + slip44 5555,
// SigningStargateClient with the cosmos defaults + the fundjs beacon Msg registry).
import { stringToPath } from "@cosmjs/crypto";
import { DirectSecp256k1HdWallet, GeneratedType, Registry } from "@cosmjs/proto-signing";
import { defaultRegistryTypes, DeliverTxResponse, SigningStargateClient, StdFee } from "@cosmjs/stargate";
import { registry as beaconRegistry } from "@unification-com/fundjs/mainchain/beacon/v1/tx.registry";

const UND_PREFIX = "und";
const UND_SLIP44 = 5555; // Unification BIP44 coin type
const REGISTER_TYPE_URL = "/mainchain.beacon.v1.MsgRegisterBeacon";
const RECORD_TYPE_URL = "/mainchain.beacon.v1.MsgRecordBeaconTimestamp";

export type BeaconSigner = { client: SigningStargateClient; address: string };

// Connect a signing client for the funded beacon-writer key.
export async function connectBeaconSigner(rpc: string, mnemonic: string): Promise<BeaconSigner> {
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: UND_PREFIX,
    hdPaths: [stringToPath(`m/44'/${UND_SLIP44}'/0'/0/0`)],
  });
  const [account] = await wallet.getAccounts();

  // cosmos defaults + the fundjs beacon Msg types. The telescope types are runtime-compatible with the
  // cosmjs Registry (the fundjs-examples signing scripts prove it); the cast just satisfies the stricter
  // GeneratedType structural type at compile time.
  const registry = new Registry(defaultRegistryTypes);
  for (const [typeUrl, type] of beaconRegistry) {
    registry.register(typeUrl, type as unknown as GeneratedType);
  }

  const client = await SigningStargateClient.connectWithSigner(rpc, wallet, { registry });
  return { client, address: account.address };
}

// Find a result event attribute by key across all emitted events (cosmjs 0.38 returns decoded strings).
const eventAttr = (res: DeliverTxResponse, key: string): string | null => {
  for (const ev of res.events) {
    for (const a of ev.attributes) {
      if (a.key === key) {
        return a.value;
      }
    }
  }
  return null;
};

const assertOk = (res: DeliverTxResponse): void => {
  if (res.code !== 0) {
    throw new Error(`tx ${res.transactionHash} failed: code=${res.code} ${res.rawLog ?? ""}`);
  }
};

// Register a new beacon (one-off). Returns the assigned beacon id (from the `beacon_id` event attr).
export async function registerBeacon(s: BeaconSigner, moniker: string, name: string, fee: StdFee): Promise<{ beaconId: number; txHash: string }> {
  const msg = { typeUrl: REGISTER_TYPE_URL, value: { moniker, name, owner: s.address } };
  const res = await s.client.signAndBroadcast(s.address, [msg], fee);
  assertOk(res);
  const id = eventAttr(res, "beacon_id");
  if (!id) {
    throw new Error("register: no beacon_id in tx events");
  }
  return { beaconId: Number(id), txHash: res.transactionHash };
}

export type RecordResult = { timestampId: number; txHash: string; submitTime: number };

// Record one timestamp hash (the Merkle root) on the beacon. submitTime is the unix epoch we claim.
export async function recordTimestamp(s: BeaconSigner, beaconId: number, hash: string, submitTime: number, fee: StdFee): Promise<RecordResult> {
  const msg = {
    typeUrl: RECORD_TYPE_URL,
    value: { beaconId: BigInt(beaconId), hash, submitTime: BigInt(submitTime), owner: s.address },
  };
  const res = await s.client.signAndBroadcast(s.address, [msg], fee);
  assertOk(res);
  const tsId = eventAttr(res, "beacon_timestamp_id");
  return { timestampId: tsId ? Number(tsId) : 0, txHash: res.transactionHash, submitTime };
}

export const disconnect = (s: BeaconSigner): void => s.client.disconnect();
