// lib/cosmosPage.ts
// Shared Cosmos REST-adapter curation (#128). Every Cosmos source (Osmosis SQS, Astroport/Neutron, …)
// discovers pools from its own REST API, then applies the SAME curation to turn them into the
// source-neutral NormalisedPage the orchestrator feeds the verdict: identify both tokens via the
// chain-registry, dedupe to the deepest pool per denom-pair, orient a stablecoin to the quote, and
// drop same-symbol / unpriceable junk. Each per-source adapter only maps its own API shape to a
// CosmosPoolCandidate; this builder does the rest, so the adapters can't drift (DRY).

import { CosmosAsset } from "./cosmosRegistry";
import { NormalisedPool, NormalisedToken } from "./ingestAdapter";

// One pool a Cosmos adapter has extracted from its source API, reduced to the fields the shared
// curation needs: the unique pool key, the two token denoms, USD liquidity, 24h volume, and each
// token's USD spot price.
export type CosmosPoolCandidate = {
  poolId: string;
  denom0: string;
  denom1: string;
  reserveUsd: number;
  volume24hUsd: number;
  priceUsd0: number;
  priceUsd1: number;
};

// USD-stablecoin coingecko ids — orient a 2-asset pool so a stablecoin is the QUOTE (X-USDC, not
// USDC-X), matching how a consumer queries BASE.USDC. Orientation is cosmetic (the canonical key +
// pricing are order-independent), but it makes the stored pair symbol natural.
const STABLE_CG_IDS = new Set(["usd-coin", "tether", "dai", "axlusdc", "first-digital-usd"]);

const toToken = (a: CosmosAsset, priceUsd: number): NormalisedToken => ({
  address: a.denom,
  name: a.name,
  symbol: a.symbol,
  decimals: a.decimals,
  coingeckoCoinId: a.coingeckoCoinId,
  priceUsd,
  marketCapUsd: 0,
  totalSupply: 0,
  volume24hUsd: 0,
});

// Curate a Cosmos source's candidate pools into a normalised page: identify both tokens via the
// chain-registry, dedupe to the deepest pool per denom-pair, orient a stablecoin to the quote, and
// drop same-symbol / unpriceable junk. poolCount is the registry-identified candidates considered
// (before dedupe) — the orchestrator uses it to decide the page had data.
export function buildCosmosPage(
  assets: Map<string, CosmosAsset>,
  candidates: CosmosPoolCandidate[],
): { poolCount: number; pools: NormalisedPool[]; tokens: Map<string, NormalisedToken> } {
  // Both denoms must be chain-registry-identified (the Cosmos analogue of a known-token discovery) and
  // the pool must have an id.
  const known = candidates.filter((c) => c.poolId && assets.has(c.denom0) && assets.has(c.denom1));

  // A denom-pair can have several pools; keep the DEEPEST, keyed by the unordered denom-pair.
  const deepest = new Map<string, CosmosPoolCandidate>();
  for (const c of known) {
    const key = [c.denom0, c.denom1].sort().join("|");
    const cur = deepest.get(key);
    if (!cur || c.reserveUsd > cur.reserveUsd) {
      deepest.set(key, c);
    }
  }

  const tokens = new Map<string, NormalisedToken>();
  const pools: NormalisedPool[] = [];
  for (const c of Array.from(deepest.values())) {
    const a0 = assets.get(c.denom0) as CosmosAsset;
    const a1 = assets.get(c.denom1) as CosmosAsset;
    // Orient a lone stablecoin to the quote.
    const flip = STABLE_CG_IDS.has(a0.coingeckoCoinId) && !STABLE_CG_IDS.has(a1.coingeckoCoinId);
    const baseDenom = flip ? c.denom1 : c.denom0;
    const quoteDenom = flip ? c.denom0 : c.denom1;
    const baseAsset = flip ? a1 : a0;
    const quoteAsset = flip ? a0 : a1;
    const basePrice = flip ? c.priceUsd1 : c.priceUsd0;
    const quotePrice = flip ? c.priceUsd0 : c.priceUsd1;

    // Skip a same-symbol pool (two bridge variants of one asset, e.g. USDC/USDC) — degenerate as a
    // price feed — and an unpriceable pool (no USD price for a side) the oracle could never price.
    if (baseAsset.symbol === quoteAsset.symbol || basePrice <= 0 || quotePrice <= 0) {
      continue;
    }

    tokens.set(baseDenom, toToken(baseAsset, basePrice));
    tokens.set(quoteDenom, toToken(quoteAsset, quotePrice));
    pools.push({
      poolId: c.poolId,
      baseAddress: baseDenom,
      quoteAddress: quoteDenom,
      reserveUsd: c.reserveUsd,
      volume24hUsd: c.volume24hUsd,
      marketCapUsd: 0,
      priceChange24h: 0,
      buys24h: 0,
      sells24h: 0,
      buyers24h: 0,
      sellers24h: 0,
      baseTokenPriceUsd: basePrice,
      quoteTokenPriceUsd: quotePrice,
      poolCreatedAt: null,
    });
  }

  return { poolCount: known.length, pools, tokens };
}
