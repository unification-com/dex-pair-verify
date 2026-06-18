// worker/fulfilment-watcher/receipt.ts
// Pure decode + commitment for an OoO Router `RequestFulfilled` event (#130 path ii). No I/O, no web3 —
// the topic0 is precomputed (locked by a test) and decoding is plain hex slicing, so this is fully
// unit-testable. The receipt hash (sha256 of the canonical receipt) is the 64-char value the beacon-writer
// records on-chain; `metadata` is the off-chain descriptor (→ the #129 on-chain metadata field later).
import { createHash } from "crypto";

// topic0 = keccak256("RequestFulfilled(address,address,bytes32,uint256)"). Locked in receipt.test.ts.
export const REQUEST_FULFILLED_TOPIC = "0xf583670c1cbc98b1818384b70c30a178114600cb3ae010c993699941635ddc12";

// A raw eth_getLogs entry (the fields we read).
export type EvmLog = { address: string; topics: string[]; data: string; transactionHash: string; blockNumber: string };

// A decoded fulfilment. requestedData is kept as raw 32-byte hex (no BigInt → tsc-target-safe; the receipt
// only needs a deterministic representation, not arithmetic).
export type Fulfilment = {
  chain: string;
  chainId: number;
  router: string;
  consumer: string;
  provider: string;
  requestId: string;
  requestedData: string;
  txHash: string;
  blockNumber: number;
};

const addrFromTopic = (t: string): string => `0x${t.slice(-40)}`.toLowerCase(); // last 20 bytes of the 32-byte topic
const sha256hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

// Decode a RequestFulfilled log, or null if it is not one. consumer/provider/requestId are the 3 indexed
// topics; requestedData is the single non-indexed param (the log data).
export function decodeFulfilment(log: EvmLog, ctx: { chain: string; chainId: number }): Fulfilment | null {
  if (!log.topics || (log.topics[0] ?? "").toLowerCase() !== REQUEST_FULFILLED_TOPIC || log.topics.length < 4) {
    return null;
  }
  return {
    chain: ctx.chain,
    chainId: ctx.chainId,
    router: log.address.toLowerCase(),
    consumer: addrFromTopic(log.topics[1]),
    provider: addrFromTopic(log.topics[2]),
    requestId: log.topics[3].toLowerCase(),
    requestedData: (log.data || "0x").toLowerCase(),
    txHash: log.transactionHash.toLowerCase(),
    blockNumber: parseInt(log.blockNumber, 16),
  };
}

export type ReceiptCommit = { refKey: string; hash: string; metadata: string };

// The on-chain receipt hash + off-chain descriptor for a fulfilment.
export function receiptCommit(f: Fulfilment): ReceiptCommit {
  const canonical = JSON.stringify({
    v: 1,
    chainId: f.chainId,
    router: f.router,
    requestId: f.requestId,
    consumer: f.consumer,
    provider: f.provider,
    requestedData: f.requestedData,
    txHash: f.txHash,
    block: f.blockNumber,
  });
  return {
    refKey: `${f.chain}/${f.router}/${f.requestId}`,
    hash: sha256hex(canonical),
    metadata: `type=fulfil;net=${f.chain};router=${f.router};req=${f.requestId.slice(0, 18)}`,
  };
}
