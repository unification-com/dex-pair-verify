// worker/fulfilment-watcher/receipt.ts
// Pure decode + commitment for an OoO Router `RequestFulfilled` event (#130 path ii). No I/O, no web3 —
// the topic0 is precomputed (locked by a test) and decoding is plain hex slicing, so this is fully
// unit-testable. The receipt hash (sha256 of the canonical receipt) is the 64-char value the beacon-writer
// records on-chain; `metadata` is the off-chain descriptor (→ the #129 on-chain metadata field later).
import { createHash } from "crypto";

// topic0 = keccak256("RequestFulfilled(address,address,bytes32,uint256)"). Locked in receipt.test.ts.
export const REQUEST_FULFILLED_TOPIC = "0xf583670c1cbc98b1818384b70c30a178114600cb3ae010c993699941635ddc12";

// topic0 = keccak256("DataRequested(address,address,uint256,bytes32,bytes32)"). The request side — carries the
// queried endpoint (→ pair) and the fee, which the fulfilment event does NOT. Locked in receipt.test.ts.
export const DATA_REQUESTED_TOPIC = "0x547392811f4eab1074705e8d6a5a91322c67e4565b3781b385e03f649f1b38cb";

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

// A decoded request (the DataRequested side). `pair` is the queried endpoint (e.g. "WETH.SHIB.AD"); `feePaid`
// is the xFUND fee in base units (uint256, kept as a string — no BigInt arithmetic, tsc-target-safe).
export type DataRequest = {
  chain: string;
  chainId: number;
  router: string;
  consumer: string;
  requestId: string;
  pair: string;
  feePaid: string;
  txHash: string;
  blockNumber: number;
};

// Decode a 32-byte hex word to its trimmed ASCII text (trailing NUL padding stripped). Used for the bytes32
// endpoint. Non-printable bytes are dropped defensively.
function bytes32ToText(word: string): string {
  const hex = word.replace(/^0x/, "");
  let out = "";
  for (let i = 0; i + 2 <= hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (code >= 0x20 && code < 0x7f) out += String.fromCharCode(code);
  }
  return out;
}

// Decode a DataRequested log, or null if it is not one. consumer/provider/requestId are the 3 indexed topics;
// the non-indexed data is abi.encode(uint256 fee, bytes32 endpoint) = two 32-byte words.
export function decodeDataRequested(log: EvmLog, ctx: { chain: string; chainId: number }): DataRequest | null {
  if (!log.topics || (log.topics[0] ?? "").toLowerCase() !== DATA_REQUESTED_TOPIC || log.topics.length < 4) {
    return null;
  }
  const data = (log.data || "0x").replace(/^0x/, "");
  const feeWord = data.slice(0, 64); // uint256 fee
  const endpointWord = data.slice(64, 128); // bytes32 endpoint
  return {
    chain: ctx.chain,
    chainId: ctx.chainId,
    router: log.address.toLowerCase(),
    consumer: addrFromTopic(log.topics[1]),
    requestId: log.topics[3].toLowerCase(),
    pair: bytes32ToText(endpointWord),
    feePaid: feeWord ? BigInt(`0x${feeWord}`).toString() : "0",
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
