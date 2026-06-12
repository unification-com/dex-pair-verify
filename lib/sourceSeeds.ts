// lib/sourceSeeds.ts
// Curated subgraph seed map (Phase 4, 4.A auto-fill) — the 4.D target catalogue of
// EVM DEXs we plan to fully support, each with its The Graph decentralised-network
// subgraph deployment ID, factory address, and schema family. Pre-fills the
// /admin/sources promote form (matched by GT network+dex slug) so onboarding a
// recognised target is confirm-and-go, and feeds the empirical validation CLI
// (`yarn validate-seeds`) which probes each ID with a REAL query before it's trusted.
//
// The decentralised endpoint is the reliable PAID primary. A free tier (Studio
// free-tier / self-hosted-public / DEX-run, per availability) is layered on per
// source under the T6.5/T6.6 multi-endpoint model where one exists — not every
// major DEX has a free production-grade endpoint.
//
// Provenance: the 7 baseline entries are lifted verbatim from the wired
// lib/sources.js (already in production); new targets are sourced from DEX docs /
// The Graph Explorer / DefiLlama dimension-adapters and validated before inclusion.

import { SchemaFamily } from "./subgraphVerify";

export type SourceSeed = {
  chain: string; // internal chain id
  dex: string; // internal dex id
  gtNetwork: string; // GeckoTerminal network slug (matches a discovered candidate's chain)
  gtDex: string; // GeckoTerminal dex slug (matches a candidate's dex)
  schemaFamily: SchemaFamily; // "univ2" | "univ3" | "univ4" | "messari" | "custom"  (Algebra → univ3 for price)
  subgraphId: string; // The Graph decentralised-network deployment ID
  factoryAddress: string;
  priceable: boolean; // false = needs a go-ooo template that doesn't exist yet (e.g. Solidly)
  note?: string;
};

// The Graph decentralised-network gateway with the {API_KEY} placeholder. Matches
// the host the wired lib/sources.js entries use (proven working with THEGRAPH_API_KEY).
const GATEWAY = "https://gateway-arbitrum.network.thegraph.com/api/{API_KEY}/subgraphs/id/";

// Build the {API_KEY} URL template for a decentralised-network subgraph id.
export const decentralizedTemplate = (subgraphId: string): string => `${GATEWAY}${subgraphId}`;

// Look up a seed by GeckoTerminal (network, dex) slug — the key a discovered
// CandidateDexNetwork row carries — so /admin/sources can pre-fill its form.
export const seedForGt = (gtNetwork: string, gtDex: string): SourceSeed | undefined =>
  SOURCE_SEEDS.find((s) => s.gtNetwork === gtNetwork && s.gtDex === gtDex);

export const SOURCE_SEEDS: SourceSeed[] = [
  // ── Baseline: the 7 GT-backed sources already wired in lib/sources.js ──
  { chain: "eth", dex: "uniswap_v2", gtNetwork: "eth", gtDex: "uniswap_v2", schemaFamily: "univ2", subgraphId: "EYCKATKGBKLWvSfwvBjzfCBmGwYNdVkduYXVivCsLRFu", factoryAddress: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", priceable: true },
  { chain: "eth", dex: "uniswap_v3", gtNetwork: "eth", gtDex: "uniswap_v3", schemaFamily: "univ3", subgraphId: "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV", factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984", priceable: true },
  { chain: "eth", dex: "sushiswap", gtNetwork: "eth", gtDex: "sushiswap", schemaFamily: "univ2", subgraphId: "6NUtT5mGjZ1tSshKLf5Q3uEEJtjBZJo1TpL5MXsUBqrT", factoryAddress: "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac", priceable: true },
  { chain: "eth", dex: "shibaswap", gtNetwork: "eth", gtDex: "shibaswap", schemaFamily: "univ2", subgraphId: "61LXXvGA1KXkJZbCceYqw9APcwTGefK5MytwnVsdAQpw", factoryAddress: "0x115934131916C8b277DD010Ee02de363c09d037c", priceable: true },
  { chain: "polygon_pos", dex: "quickswap_v3", gtNetwork: "polygon_pos", gtDex: "quickswap_v3", schemaFamily: "univ3", subgraphId: "FqsRcH1XqSjqVx9GRTvEJe959aCbKrcyGgDWBrUkG24g", factoryAddress: "0x411b0fAcC3489691f28ad58c47006AF5E3Ab3A28", priceable: true },
  { chain: "xdai", dex: "honeyswap", gtNetwork: "xdai", gtDex: "honeyswap", schemaFamily: "univ2", subgraphId: "HTxWvPGcZ5oqWLYEVtWnVJDfnai2Ud1WaABiAR72JaSJ", factoryAddress: "0xA818b4F111Ccac7AA31D0BCc0806d64F2E0737D7", priceable: true },
  { chain: "bsc", dex: "bsc_pancakeswap_v3", gtNetwork: "bsc", gtDex: "pancakeswap-v3-bsc", schemaFamily: "univ3", subgraphId: "A1fvJWQLBeUAggX2WQTMm3FKjXTekNXo77ZySun4YN2m", factoryAddress: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865", priceable: true },

  // Uniswap v4 (eth) — the first singleton/hooks family. The "factory" slot carries the singleton
  // PoolManager address (v4 has no per-pool factory); pools are 32-byte poolIds; native ETH (0x0)
  // is normalised to WETH at ingest; only no-hook pools are priced (go-ooo univ4 family + dpv univ4).
  { chain: "eth", dex: "uniswap_v4", gtNetwork: "eth", gtDex: "uniswap-v4-ethereum", schemaFamily: "univ4", subgraphId: "DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G", factoryAddress: "0x000000000004444c5dc75cB358380D2e3dE08A90", priceable: true, note: "Uniswap v4 singleton PoolManager; 32-byte poolIds; native ETH→WETH; no-hook pools only" },

  // ── New 4.D targets (researched; validated live via `yarn validate-seeds`).
  //    GT slugs map to discovered candidates for /admin/sources pre-fill. IDs the
  //    research flagged UNKNOWN (Sushi-V2 on polygon/bsc/gnosis/avax, QuickSwap V2,
  //    Biswap V2, Uniswap-V2 arbitrum) are deliberately omitted — they stay manual. ──

  // Tier A — existing chains, new DEXs
  { chain: "bsc", dex: "pancakeswap_v2", gtNetwork: "bsc", gtDex: "pancakeswap_v2", schemaFamily: "univ2", subgraphId: "Aj9TDh9SPcn7cz4DXW26ga22VnBzHhPVuKGmE4YBzDFj", factoryAddress: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73", priceable: true, note: "BSC univ2: tracks reserveBNB (reserveUSD unpopulated); priced via token0Price" },
  { chain: "polygon_pos", dex: "uniswap_v3", gtNetwork: "polygon_pos", gtDex: "uniswap_v3_polygon_pos", schemaFamily: "univ3", subgraphId: "3hCPRGf4z88VC5rsBKU5AA9FBBq5nF3jbKJG7VZCbhjm", factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984", priceable: true },
  { chain: "bsc", dex: "uniswap_v3", gtNetwork: "bsc", gtDex: "uniswap-bsc", schemaFamily: "univ3", subgraphId: "F85MNzUGYqgSHSHRGgeVMNsdnW1KtZSVgFULumXRZTw2", factoryAddress: "0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7", priceable: true },
  { chain: "bsc", dex: "thena", gtNetwork: "bsc", gtDex: "thena-fusion", schemaFamily: "univ3", subgraphId: "34V3E1o5Kf9CMcnSdmxF7qdQCzEsw8Psa1FnFhHgGrz2", factoryAddress: "0x306F06C147f064A010530292A1EB6737c3e378e4", priceable: false, note: "Thena Fusion (Algebra): Pool lacks totalValueLockedUSD — needs Algebra-aware fields (camelot_v3's Algebra subgraph does expose it; thena's does not)" },

  // Tier B — new chains
  { chain: "arbitrum", dex: "uniswap_v3", gtNetwork: "arbitrum", gtDex: "uniswap_v3_arbitrum", schemaFamily: "univ3", subgraphId: "3V7ZY6muhxaQL5qvntX1CFXJ32W7BxXZTGTwmpH5J4t3", factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984", priceable: true },
  { chain: "arbitrum", dex: "sushiswap", gtNetwork: "arbitrum", gtDex: "sushiswap_arbitrum", schemaFamily: "messari", subgraphId: "9tSS5FaePZnjmnXnSKCCqKVLAqA6eGg6jA2oRojsXUbP", factoryAddress: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4", priceable: true, note: "Messari standardised dex-amm schema (liquidityPools/inputTokens lastPriceUSD); priced by the go-ooo + dpv messari family" },
  { chain: "arbitrum", dex: "camelot_v2", gtNetwork: "arbitrum", gtDex: "camelot", schemaFamily: "univ2", subgraphId: "8zagLSufxk5cVhzkzai3tyABwJh53zxn9tmUYJcJxijG", factoryAddress: "0x6EcCab422D763aC031210895C81787E87B43A652", priceable: true },
  { chain: "arbitrum", dex: "camelot_v3", gtNetwork: "arbitrum", gtDex: "camelot-v3", schemaFamily: "univ3", subgraphId: "3utanEBA9nqMjPnuQP1vMCCys6enSM3EawBpKTVwnUw2", factoryAddress: "0x1a3c9B1d2F0529D97f2afC5136Cc23e58f1FD35B", priceable: true, note: "Camelot V3 (Algebra → univ3 for price)" },
  { chain: "base", dex: "uniswap_v3", gtNetwork: "base", gtDex: "uniswap-v3-base", schemaFamily: "univ3", subgraphId: "HMuAwufqZ1YCRmzL2SfHTVkzZovC9VL2UAKhjvRqKiR1", factoryAddress: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD", priceable: true },
  { chain: "base", dex: "sushiswap", gtNetwork: "base", gtDex: "sushiswap-v2-base", schemaFamily: "univ2", subgraphId: "7Tbc4o9M99Si1x7yenGXmsbHyMgUTPKJU1GjDdaXzXK3", factoryAddress: "0x71524B4f93c58fcbF659783284E38825f0622859", priceable: true },
  { chain: "optimism", dex: "uniswap_v3", gtNetwork: "optimism", gtDex: "uniswap_v3_optimism", schemaFamily: "univ3", subgraphId: "Jhu62RoQqrrWoxUUhWFkiMHDrqsTe7hTGb3NGiHPuf9", factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984", priceable: true },

  // Solidly (ve(3,3)) — seeded but NOT priceable until the go-ooo Solidly template (4.B).
  { chain: "base", dex: "aerodrome_slipstream", gtNetwork: "base", gtDex: "aerodrome-slipstream", schemaFamily: "univ3", subgraphId: "GENunSHWLBXm59mBSgPzQ8metBEp9YDfdqwFr91Av1UM", factoryAddress: "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A", priceable: true, note: "Aerodrome Slipstream (concentrated liquidity → univ3); classic Solidly aerodrome-base pools are a separate source (await a Solidly/Messari template)" },
  { chain: "optimism", dex: "velodrome", gtNetwork: "optimism", gtDex: "velodrome-finance-v2", schemaFamily: "messari", subgraphId: "A4Y1A82YhSLTn998BVVELC8eWzhi992k4ZitByvssxqA", factoryAddress: "0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a", priceable: true, note: "Messari standardised dex-amm schema (V2 — the A4Y1A82Y subgraph is Velodrome Finance V2, so the GT slug must be velodrome-finance-v2 to keep pool addresses aligned with the subgraph; the bare 'velodrome' GT slug is V1 and does not match)" },
];
