// Unit tests for the OoO Router registry (T8) — built-in deployments, env overrides, dev-via-env.

import { afterEach, describe, expect, it } from "vitest";

import { isOooChain, oooRouterForChain } from "../../lib/oooRouters";

describe("oooRouterForChain", () => {
  afterEach(() => {
    delete process.env.OOO_ROUTER_RPC_1;
    delete process.env.OOO_ROUTER_RPC_31337;
    delete process.env.OOO_ROUTER_ADDRESS_31337;
  });

  it("resolves a built-in chain with its default keyless RPC", () => {
    const r = oooRouterForChain(1);
    expect(r?.name).toBe("eth");
    expect(r?.router).toBe("0x9ac9AE20a17779c17b069b48A8788e3455fC6121");
    expect(r?.rpc).toContain("publicnode");
  });

  it("resolves the testnet (sepolia)", () => {
    expect(oooRouterForChain(11155111)?.name).toBe("sepolia");
  });

  it("returns null for a non-OoO chain with no env config", () => {
    expect(oooRouterForChain(31337)).toBeNull();
  });

  it("adds a dev/anvil chain entirely via env (rpc + address)", () => {
    process.env.OOO_ROUTER_RPC_31337 = "http://127.0.0.1:8545";
    process.env.OOO_ROUTER_ADDRESS_31337 = "0xaBC0000000000000000000000000000000000001";
    const r = oooRouterForChain(31337);
    expect(r?.rpc).toBe("http://127.0.0.1:8545");
    expect(r?.router).toBe("0xaBC0000000000000000000000000000000000001");
  });

  it("env RPC override wins for a built-in chain", () => {
    process.env.OOO_ROUTER_RPC_1 = "http://my-eth-rpc";
    expect(oooRouterForChain(1)?.rpc).toBe("http://my-eth-rpc");
  });

  it("isOooChain reflects resolvability", () => {
    expect(isOooChain(1)).toBe(true);
    expect(isOooChain(424242)).toBe(false);
  });
});
