// lib/cosmosRegistry.ts
// Cosmos chain-registry asset-list resolver (#128 Phase 2b) — the authoritative Cosmos token
// identity source, the analogue of the EVM token-lists dpv already trusts. Maps an on-chain denom
// (native "uosmo", an "ibc/..." hash, or a "factory/..." token) to its canonical
// {symbol, decimals, coingeckoCoinId} from github.com/cosmos/chain-registry.
//
// This is how a Cosmos source's tokens acquire a coingeckoCoinId AT INGEST, which is the precondition
// for the (already source-neutral) verdict engine to identify, canonically-key and auto-verify them —
// exactly as a GeckoTerminal-supplied cgId does for an EVM token. A denom the registry does not list,
// or lists without a coingecko id, correctly stays unidentified (an untrusted token the operator must
// confirm) rather than being waved through.
//
// Keyed by the unique `base` denom, NEVER the symbol: a chain lists many same-symbol variants (e.g.
// Osmosis carries six different USDC bridges, only the native Noble one canonically `usd-coin`), so
// the denom is the only safe identity key — the Cosmos analogue of an EVM contract address.

// Our internal chain id → the cosmos/chain-registry directory. Adding a Cosmos chain is one entry
// here (after confirming its asset-list lists the denoms we curate — the "verify before seeding"
// discipline).
const REGISTRY_DIR: Record<string, string> = {
  osmosis: "osmosis",
};

const REGISTRY_BASE = "https://raw.githubusercontent.com/cosmos/chain-registry/master";

// Blue-chip symbols the chain-registry lists WITHOUT a coingecko_id — chiefly Osmosis's "alloyed"
// synthetics (allBTC=Bitcoin, allETH=Ethereum, allUSDT=Tether, …), which fuse an asset's bridge
// variants into one canonical Osmosis token but carry coingecko_id: null (all 32 alloyed assets do).
// These are deep, genuine assets, so without this overlay they would stay unidentified (NeedsReview)
// forever. Mapped by symbol → coingecko id, and applied ONLY when the registry itself supplies no id,
// so a future registry that adds the id wins. Deliberately narrow: only unambiguous blue-chips —
// niche staking derivatives (stTIA, ampOSMO) + minor stablecoins stay in manual review.
const SYMBOL_COINGECKO_OVERLAY: Record<string, string> = {
  BTC: "bitcoin",
  WBTC: "wrapped-bitcoin",
  ETH: "ethereum",
  USDT: "tether",
  USDC: "usd-coin",
  DOGE: "dogecoin",
  LINK: "chainlink",
  SHIB: "shiba-inu",
  PEPE: "pepe",
  SOL: "solana",
};

// The slice of a chain-registry asset we consume (the file carries much more).
type RegistryAsset = {
  base?: string;
  symbol?: string;
  name?: string;
  display?: string;
  coingecko_id?: string;
  denom_units?: { denom?: string; exponent?: number }[];
};
type RegistryAssetList = { assets?: RegistryAsset[] };

// A resolved Cosmos token identity, in the same shape the ingest path stores for any token.
export type CosmosAsset = {
  denom: string;
  symbol: string;
  name: string;
  decimals: number;
  coingeckoCoinId: string;
};

// decimals = the exponent of the denom_unit that is the asset's `display` (human) unit — e.g. OSMO's
// "osmo" unit is exponent 6, USDC's "usdc" unit is 6. Falls back to the largest exponent present when
// the display unit isn't found (every asset has a base unit at exponent 0, so this is always defined).
const assetDecimals = (a: RegistryAsset): number => {
  const units = a.denom_units ?? [];
  const display = units.find((u) => u.denom === a.display);
  if (display?.exponent !== undefined) {
    return display.exponent;
  }
  return units.reduce((max, u) => Math.max(max, u.exponent ?? 0), 0);
};

// The asset-list transport, injectable so tests run without a network call.
export type AssetListFetcher = (registryDir: string) => Promise<RegistryAssetList | null>;

const defaultFetcher: AssetListFetcher = async (registryDir) => {
  try {
    const res = await fetch(`${REGISTRY_BASE}/${registryDir}/assetlist.json`);
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as RegistryAssetList;
  } catch {
    return null;
  }
};

// Process-memoised denom → CosmosAsset map per chain. Asset-lists are ~1 MB and change rarely, so one
// load per process is right; the map is keyed by `base` denom for O(1) lookup.
const cache = new Map<string, Promise<Map<string, CosmosAsset>>>();

const buildMap = async (chain: string, fetcher: AssetListFetcher): Promise<Map<string, CosmosAsset>> => {
  const out = new Map<string, CosmosAsset>();
  const dir = REGISTRY_DIR[chain];
  if (!dir) {
    return out;
  }
  const list = await fetcher(dir);
  for (const a of list?.assets ?? []) {
    if (!a.base) {
      continue;
    }
    const symbol = a.symbol ?? "";
    // The registry's id wins; fall back to the blue-chip overlay only when it supplies none (chiefly
    // the alloyed synthetics, which carry coingecko_id: null).
    const coingeckoCoinId = (a.coingecko_id ?? "").trim() || SYMBOL_COINGECKO_OVERLAY[symbol] || "";
    out.set(a.base, {
      denom: a.base,
      symbol,
      name: a.name ?? symbol,
      decimals: assetDecimals(a),
      coingeckoCoinId,
    });
  }
  return out;
};

// Whether dpv has a chain-registry mapping for a chain (i.e. it is a supported Cosmos chain).
export const isCosmosRegistryChain = (chain: string): boolean => chain in REGISTRY_DIR;

// Load (memoised) the chain's denom → CosmosAsset map. Returns an empty map for a chain with no
// registry mapping. force=true refreshes; fetcher overrides the transport (tests).
export function cosmosAssetMap(
  chain: string,
  opts: { force?: boolean; fetcher?: AssetListFetcher } = {},
): Promise<Map<string, CosmosAsset>> {
  if (!cache.has(chain) || opts.force) {
    cache.set(chain, buildMap(chain, opts.fetcher ?? defaultFetcher));
  }
  return cache.get(chain) as Promise<Map<string, CosmosAsset>>;
}

// Resolve one denom on a chain to its canonical Cosmos identity, or null when the chain has no
// registry mapping or the denom isn't listed.
export async function resolveCosmosAsset(
  chain: string,
  denom: string,
  opts: { fetcher?: AssetListFetcher } = {},
): Promise<CosmosAsset | null> {
  const map = await cosmosAssetMap(chain, { fetcher: opts.fetcher });
  return map.get(denom) ?? null;
}

// Test-only: drop the memoised maps so a stubbed fetcher takes effect on the next load.
export function _clearCosmosRegistryCache(): void {
  cache.clear();
}
