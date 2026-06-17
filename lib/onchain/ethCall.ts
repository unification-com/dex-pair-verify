// lib/onchain/ethCall.ts
// The shared raw JSON-RPC eth_call helper used by every on-chain read in the verifier (the DEX
// factory() fence and the OoO provider-registration auth check). Kept transport-only and injectable so
// each caller stays unit-testable without a live RPC. Returns the raw hex result string, or null on any
// failure (non-2xx, JSON-RPC error, revert, network) — callers decode/interpret per their ABI.

export type EthCaller = (rpcUrl: string, to: string, data: string) => Promise<string | null>;

export const defaultEthCall: EthCaller = async (rpcUrl, to, data) => {
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
