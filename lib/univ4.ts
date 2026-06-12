// lib/univ4.ts
// Shared Uniswap-v4 helpers, used across the source-verify probe (subgraphVerify), the
// price-test simulator (priceFetch) and pool ingest. v4 differs from v3 in two ways dpv must
// handle the same way everywhere (and the same way the go-ooo univ4 family does):
//
//   - Hooks. A v4 pool can attach arbitrary hook logic (custom curves, dynamic fees) that can
//     make its reported price non-canonical or manipulable. For an oracle only no-hook pools
//     (hooks == the zero address) are priceable; a hooked pool is skipped.
//   - Native currency. v4 pools can hold native ETH as currency address 0x0; the subgraph
//     reports it with id 0x0000...0000 and symbol "ETH". dpv tracks the native side as the
//     chain's wrapped token (WETH) so identity, canonical lookup and pricing line up - and so a
//     consumer queries WETH.USDC.
//
// Pool ids in v4 are 32-byte poolIds (a hash of the PoolKey), not 20-byte pool addresses.

import { utils as web3Utils } from "web3";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// A v4 poolId is a 32-byte hash (0x + 64 hex), not a 20-byte pool address.
const POOL_ID_RE = /^0x[0-9a-fA-F]{64}$/;

// Resolve a pool's on-chain key from GeckoTerminal's pool `address`: a 20-byte contract address
// for v2/v3 pools (checksummed), or a 32-byte poolId hash for Uniswap-v4-style singletons
// (lower-cased - it is a hash, not an address, so toChecksumAddress throws on it and would silently
// drop the whole v4 pool). Returns null for anything else.
export const poolAddressFromGt = (raw: string | undefined | null): string | null => {
  if (!raw) {
    return null;
  }
  const v = raw.trim();
  if (POOL_ID_RE.test(v)) {
    return v.toLowerCase();
  }
  try {
    return web3Utils.toChecksumAddress(v);
  } catch {
    return null;
  }
};

// Wrapped-native symbol per chain (native currency id 0x0 → this symbol). Only the ETH-native
// chains v4 is being brought online on are mapped (all wrap to WETH); this mirrors the go-ooo
// univ4 family's map. A chain absent here gets no native rewrite, so its wrapped symbol must be
// added (and verified live) before v4 is enabled on it - the "verify before seeding" discipline.
const WRAPPED_NATIVE: Record<string, string> = {
  eth: "WETH",
  base: "WETH",
  arbitrum: "WETH",
  optimism: "WETH",
};

// The chain's wrapped-native symbol, or null when the chain is not yet mapped.
export const wrappedNativeSymbol = (chain: string): string | null =>
  WRAPPED_NATIVE[chain.toLowerCase()] ?? null;

// True when a v4 pool carries a non-zero hooks contract (and so must not be priced).
export const isHookedPool = (hooks: string | null | undefined): boolean =>
  !!hooks && hooks.toLowerCase() !== ZERO_ADDRESS;

// True when a token id is the native currency (address 0x0).
export const isNativeCurrency = (tokenId: string | null | undefined): boolean =>
  !!tokenId && tokenId.toLowerCase() === ZERO_ADDRESS;

// The wrapped token a chain's native currency (address 0x0) is mapped to at ingest. Native ETH
// has NO coingecko_coin_id on GeckoTerminal (verified live), so a native-currency token can't be
// canonically keyed - and a v4 ETH pool would never aggregate with the wrapped-ETH pools on other
// DEXs. Remapping 0x0 → the wrapped token gives it a real, CoinGecko-keyable identity (and the
// SAME "weth" coin id the existing v3 WETH pairs carry, so the canonical sibling key lines up).
export type WrappedNativeToken = {
  address: string; // the wrapped token's contract (checksummed)
  symbol: string;
  name: string;
  coingeckoCoinId: string; // must match what other DEXs' wrapped-ETH pairs use (sibling key)
  decimals: number;
};

// Only chains where v4 has been brought online + the wrapped token verified live are mapped. eth
// is verified (GeckoTerminal: WETH 0xC02a… → coingecko_coin_id "weth"; native ETH → none). Other
// chains are added when their v4 source is validated - the "verify before seeding" discipline.
const WRAPPED_NATIVE_TOKEN: Record<string, WrappedNativeToken> = {
  eth: {
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    symbol: "WETH",
    name: "Wrapped Ether",
    coingeckoCoinId: "weth",
    decimals: 18,
  },
};

// The wrapped token a chain's native currency maps to, or null when the chain is not yet mapped
// (its native-currency pools then fail to key - the safe default until it's verified + added).
export const wrappedNativeToken = (chain: string): WrappedNativeToken | null =>
  WRAPPED_NATIVE_TOKEN[chain.toLowerCase()] ?? null;

// Normalise a v4 token symbol: the native currency (id 0x0) is reported as "ETH" by the subgraph
// but dpv tracks it as the chain's wrapped token (WETH) so symbol-based pricing/identity line up.
// Other tokens (and chains without a wrapped mapping) pass through unchanged.
export const normaliseV4Symbol = (chain: string, tokenId: string, symbol: string): string => {
  const wrapped = wrappedNativeSymbol(chain);
  return wrapped && isNativeCurrency(tokenId) ? wrapped : symbol;
};
