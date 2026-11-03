// lib/schemaFamilies.ts
// The subgraph schema families dpv knows and the collection each one is priced from. Free of
// server imports so the /sources page can use it in the browser.
//
// univ3sqrt is a minimal univ3 schema: its Pool has sqrtPrice but no token0Price/token1Price and
// no USD liquidity (Pharaoh v3, Aerodrome Slipstream 2), so prices are derived from sqrtPrice and
// the token decimals (lib/poolPrice.ts; go-ooo's uniswap.V3Sqrt).

export const SCHEMA_FAMILIES = ["univ2", "univ3", "univ3sqrt", "univ4", "messari", "custom"] as const;
export type SchemaFamily = (typeof SCHEMA_FAMILIES)[number];

// The subgraph collection each priced family queries (custom has none).
export const FAMILY_COLLECTION: Record<string, string> = {
  univ2: "pairs",
  univ3: "pools",
  univ3sqrt: "pools",
  univ4: "pools",
  messari: "liquidityPools",
};
