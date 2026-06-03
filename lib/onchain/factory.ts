// On-chain factory read (Phase 5, T2). Reads a DEX pool contract's `factory()`
// via a raw JSON-RPC eth_call so the verdict engine's dexFactoryMatchesCanonical
// fence can confirm a pool was actually deployed by the canonical DEX factory
// (catching impostor pools). The eth_call is injectable so this is unit-testable
// without a live RPC.
//
// `factory()` shares the same 4-byte selector across UniswapV2/V3-style and
// Algebra-style pools, so one call covers every source. A contract without it
// reverts → we return null → the fence skips (never a false reject).

import { utils as web3Utils } from "web3";

import { chainInfo } from "../chains";

// keccak256("factory()")[:4]
const FACTORY_SELECTOR = "0xc45a0155";
const ZERO_ADDRESS = /^0x0+$/;

export type EthCaller = (rpcUrl: string, to: string, data: string) => Promise<string | null>;

const defaultEthCall: EthCaller = async (rpcUrl, to, data) => {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    });
    if (!res.ok) {
      return null;
    }
    const json = await res.json();
    if (json?.error || typeof json?.result !== "string") {
      return null;
    }
    return json.result;
  } catch {
    return null;
  }
};

// Decode a 32-byte ABI word into a checksummed address, or null when it doesn't
// cleanly hold one (revert/empty `0x`, wrong length, or the zero address).
export function decodeAddress(result: string | null): string | null {
  if (!result || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
    return null;
  }
  const addr = `0x${result.slice(-40)}`;
  if (ZERO_ADDRESS.test(addr)) {
    return null;
  }
  try {
    return web3Utils.toChecksumAddress(addr);
  } catch {
    return null;
  }
}

// Read a pool's factory() on its chain. Returns the checksummed factory address,
// or null when the chain has no configured RPC / the call fails / the contract
// has no factory() — all of which leave the fence to skip.
export async function readPoolFactory(
  chain: string,
  poolAddress: string,
  opts: { ethCall?: EthCaller } = {},
): Promise<string | null> {
  const rpc = chainInfo[chain]?.rpc;
  if (!rpc) {
    return null;
  }
  const ethCall = opts.ethCall ?? defaultEthCall;
  const result = await ethCall(rpc, poolAddress, FACTORY_SELECTOR);
  return decodeAddress(result);
}
