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

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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

// Normalise a v4 token symbol: the native currency (id 0x0) is reported as "ETH" by the subgraph
// but dpv tracks it as the chain's wrapped token (WETH) so symbol-based pricing/identity line up.
// Other tokens (and chains without a wrapped mapping) pass through unchanged.
export const normaliseV4Symbol = (chain: string, tokenId: string, symbol: string): string => {
  const wrapped = wrappedNativeSymbol(chain);
  return wrapped && isNativeCurrency(tokenId) ? wrapped : symbol;
};
