// Tests for lib/onchain/factory.ts (T2). The eth_call is injected, so these are
// deterministic unit tests for the decode + read logic.

import { describe, expect, it, vi } from "vitest";

import { decodeAddress, readPoolFactory } from "../../lib/onchain/factory";

const UNI_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
// The ABI-encoded 32-byte word that an eth_call to factory() returns.
const WORD = `0x000000000000000000000000${UNI_V3_FACTORY.slice(2).toLowerCase()}`;
const POOL = "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8";

describe("decodeAddress", () => {
  it("decodes the address from the low 20 bytes and checksums it", () => {
    expect(decodeAddress(WORD)).toBe(UNI_V3_FACTORY);
  });

  it("returns null for an empty/revert result", () => {
    expect(decodeAddress("0x")).toBeNull();
    expect(decodeAddress(null)).toBeNull();
  });

  it("returns null for the zero address", () => {
    expect(decodeAddress(`0x${"0".repeat(64)}`)).toBeNull();
  });

  it("returns null for a malformed / wrong-length result", () => {
    expect(decodeAddress("0x1234")).toBeNull();
    expect(decodeAddress(`0x${"z".repeat(64)}`)).toBeNull();
  });
});

describe("readPoolFactory", () => {
  it("reads + decodes the factory for a chain with an RPC", async () => {
    const ethCall = vi.fn(async () => WORD);
    expect(await readPoolFactory("eth", POOL, { ethCall })).toBe(UNI_V3_FACTORY);
    expect(ethCall).toHaveBeenCalledWith("https://ethereum-rpc.publicnode.com", POOL, "0xc45a0155");
  });

  it("returns null (no call) for a chain without a configured RPC", async () => {
    const ethCall = vi.fn(async () => WORD);
    expect(await readPoolFactory("qom", POOL, { ethCall })).toBeNull();
    expect(ethCall).not.toHaveBeenCalled();
  });

  it("returns null when the call fails", async () => {
    expect(await readPoolFactory("eth", POOL, { ethCall: async () => null })).toBeNull();
  });
});
