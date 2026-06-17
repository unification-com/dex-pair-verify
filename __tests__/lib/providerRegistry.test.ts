// Unit tests for the on-chain provider-registration check (T8), with an injected eth_call.

import { describe, expect, it } from "vitest";

import { encodeGetProviderMinFee, isRegisteredProvider } from "../../lib/providerRegistry";

const ADDR = "0x87C6B6761E8cc7D598cAf04f4f631e381d62D002";
const word = (hex: string): string => "0x" + hex.padStart(64, "0");
const returns = (result: string | null) => async () => result;

describe("encodeGetProviderMinFee", () => {
  it("is the selector + the address left-padded to a 32-byte word", () => {
    const data = encodeGetProviderMinFee(ADDR);
    expect(data.startsWith("0x11f8edd9")).toBe(true); // keccak256("getProviderMinFee(address)")[:4]
    expect(data.length).toBe(10 + 64);
    expect(data.endsWith("87c6b6761e8cc7d598caf04f4f631e381d62d002")).toBe(true);
  });
});

describe("isRegisteredProvider", () => {
  it("true when the Router returns a non-zero minFee", async () => {
    expect(await isRegisteredProvider(ADDR, 1, { ethCall: returns(word("0de0b6b3a7640000")) })).toBe(true); // 1e18
  });

  it("false when minFee == 0 (not registered)", async () => {
    expect(await isRegisteredProvider(ADDR, 1, { ethCall: returns(word("0")) })).toBe(false);
  });

  it("false on a chain with no OoO Router", async () => {
    expect(await isRegisteredProvider(ADDR, 424242, { ethCall: returns(word("1")) })).toBe(false);
  });

  it("false for a malformed address", async () => {
    expect(await isRegisteredProvider("0xnothex", 1, { ethCall: returns(word("1")) })).toBe(false);
  });

  it("false on an RPC failure or revert (fail-closed)", async () => {
    expect(await isRegisteredProvider(ADDR, 1, { ethCall: returns(null) })).toBe(false);
    expect(await isRegisteredProvider(ADDR, 1, { ethCall: returns("0x") })).toBe(false);
  });
});
