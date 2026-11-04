// lib/providerRegistry.ts
// The on-chain provider-registration check (T8): a wallet is an authorised OoO provider on a chain iff
// its Router minFee is > 0. registerAsProvider + setProviderMinFee both require(minFee > 0), so a
// non-zero minFee uniquely marks a registered provider (the private dataProviders mapping is exposed
// via the getProviderMinFee(address) public view). One eth_call; the RPC is injectable for tests.

import { defaultEthCall, type EthCaller } from "./onchain/ethCall";
import { oooRouterForChain } from "./oooRouters";

// keccak256("getProviderMinFee(address)")[:4]
const GET_PROVIDER_MIN_FEE_SELECTOR = "0x11f8edd9";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// ABI-encode getProviderMinFee(address): selector + the address left-padded to a 32-byte word.
export function encodeGetProviderMinFee(address: string): string {
  const addr = address.toLowerCase().replace(/^0x/, "");
  return GET_PROVIDER_MIN_FEE_SELECTOR + addr.padStart(64, "0");
}

// Is `address` a registered OoO provider on `chainId`? false for: a malformed address, a chain with no
// OoO Router, an RPC/eth_call failure (fail-closed — the caller refuses to issue a challenge), an empty
// "0x" (non-registered / revert), or minFee == 0. A registered provider returns true.
export async function isRegisteredProvider(
  address: string,
  chainId: number,
  opts: { ethCall?: EthCaller } = {},
): Promise<boolean> {
  if (!EVM_ADDRESS.test(address)) {
    return false;
  }
  const router = oooRouterForChain(chainId);
  if (!router) {
    return false;
  }
  const ethCall = opts.ethCall ?? defaultEthCall;
  const result = await ethCall(router.rpc, router.router, encodeGetProviderMinFee(address));
  if (!result || !/^0x[0-9a-fA-F]+$/.test(result) || result === "0x") {
    return false;
  }
  // minFee > 0 ⇔ the returned uint256 word is non-zero (at least one non-zero hex digit). Avoids a
  // BigInt parse (and its ES2020 target requirement) and tolerates an unpadded result.
  return !/^0x0+$/.test(result);
}
