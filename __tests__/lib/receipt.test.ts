// Tests for the fulfilment-watcher receipt decode/commit (#130 path ii). Locks the RequestFulfilled topic0
// against a live keccak, the indexed-topic decode, and the receipt-hash determinism + market-noise position.
import { describe, expect, it } from "vitest";
import { utils as web3Utils } from "web3";

import { decodeFulfilment, EvmLog, receiptCommit, REQUEST_FULFILLED_TOPIC } from "../../worker/fulfilment-watcher/receipt";

// A RequestFulfilled(address indexed consumer, address indexed provider, bytes32 indexed requestId,
// uint256 requestedData) log: 4 topics + the uint256 in data.
const log = (over: Partial<EvmLog> = {}): EvmLog => ({
  address: "0xf6b5d6eafE402d22609e685DE3394c8b359CaD31",
  topics: [
    REQUEST_FULFILLED_TOPIC,
    `0x000000000000000000000000${"11".repeat(20)}`, // consumer
    `0x000000000000000000000000${"22".repeat(20)}`, // provider
    `0x${"ab".repeat(32)}`, // requestId
  ],
  data: `0x${"00".repeat(31)}2a`, // requestedData = 42
  transactionHash: `0x${"cd".repeat(32)}`,
  blockNumber: "0x10",
  ...over,
});

describe("RequestFulfilled topic", () => {
  it("matches keccak256 of the event signature", () => {
    expect(REQUEST_FULFILLED_TOPIC).toBe(web3Utils.keccak256("RequestFulfilled(address,address,bytes32,uint256)"));
  });
});

describe("decodeFulfilment", () => {
  it("decodes the indexed topics + data", () => {
    const f = decodeFulfilment(log(), { chain: "sepolia", chainId: 11155111 });
    expect(f).not.toBeNull();
    expect(f!.consumer).toBe(`0x${"11".repeat(20)}`);
    expect(f!.provider).toBe(`0x${"22".repeat(20)}`);
    expect(f!.requestId).toBe(`0x${"ab".repeat(32)}`);
    expect(f!.requestedData).toBe(`0x${"00".repeat(31)}2a`);
    expect(f!.router).toBe("0xf6b5d6eafe402d22609e685de3394c8b359cad31"); // lower-cased
    expect(f!.blockNumber).toBe(16);
  });

  it("returns null for a non-matching or malformed log", () => {
    expect(decodeFulfilment(log({ topics: ["0xdead"] }), { chain: "eth", chainId: 1 })).toBeNull();
    expect(decodeFulfilment(log({ topics: [REQUEST_FULFILLED_TOPIC, "0x1"] }), { chain: "eth", chainId: 1 })).toBeNull(); // too few topics
  });
});

describe("receiptCommit", () => {
  it("is deterministic + carries a 64-char hash, a refKey and a fulfil descriptor", () => {
    const f = decodeFulfilment(log(), { chain: "sepolia", chainId: 11155111 })!;
    const a = receiptCommit(f);
    const b = receiptCommit(f);
    expect(a).toEqual(b);
    expect(a.hash).toHaveLength(64);
    expect(a.refKey).toBe(`sepolia/0xf6b5d6eafe402d22609e685de3394c8b359cad31/0x${"ab".repeat(32)}`);
    expect(a.metadata).toMatch(/^type=fulfil;net=sepolia;router=0xf6b5d6/);
  });

  it("a different fulfilled value changes the hash", () => {
    const f1 = decodeFulfilment(log(), { chain: "eth", chainId: 1 })!;
    const f2 = decodeFulfilment(log({ data: `0x${"00".repeat(31)}2b` }), { chain: "eth", chainId: 1 })!;
    expect(receiptCommit(f1).hash).not.toBe(receiptCommit(f2).hash);
  });
});
