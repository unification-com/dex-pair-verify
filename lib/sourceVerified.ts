// lib/sourceVerified.ts
// "Is the contract's source verified on the block explorer?" via the Etherscan V2
// multichain API (one key, `chainid` param — covers all our EVM chains). Verified
// source is a baseline trust signal; an unverified contract under a deep pool is a
// yellow flag worth seeing. Also surfaces a Proxy (upgradeable) flag. Decision
// support, never an auto-verify gate. Needs ETHERSCAN_API; degrades on failure.

import { fetchWithTimeout } from "./fetchTimeout";

export type SourceVerifiedResult = {
  verified: boolean | null;
  contractName: string | null;
  isProxy: boolean | null;
  error: string | null;
};

const blank = (error: string | null): SourceVerifiedResult => ({ verified: null, contractName: null, isProxy: null, error });

export async function fetchSourceVerified(chainId: number, address: string, apiKey: string): Promise<SourceVerifiedResult> {
  if (!apiKey) return blank("no ETHERSCAN_API key");
  const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`;
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!res) return blank("no response / timeout");
  if (!res.ok) return blank(`etherscan ${res.status}`);
  let j: Record<string, unknown>;
  try {
    j = await res.json();
  } catch {
    return blank("non-JSON response");
  }
  // status "1" + a result array. status "0" (NOTOK / rate-limit) → error.
  if (j?.status !== "1" || !Array.isArray(j.result) || j.result.length === 0) {
    return blank(typeof j?.result === "string" ? j.result : typeof j?.message === "string" ? j.message : "no result");
  }
  const r = j.result[0] as Record<string, unknown>;
  // getsourcecode always returns a row; an unverified contract has ABI === this string.
  const abi = String(r.ABI ?? "");
  const verified = abi.length > 0 && abi !== "Contract source code not verified";
  return {
    verified,
    contractName: verified && typeof r.ContractName === "string" && r.ContractName ? r.ContractName : null,
    isProxy: r.Proxy === "1" || r.Proxy === 1,
    error: null,
  };
}
