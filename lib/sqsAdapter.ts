// lib/sqsAdapter.ts
// The Osmosis SQS IngestAdapter (#128 Phase 2c) — the first non-EVM, non-GeckoTerminal source behind
// the ingest seam. It DISCOVERS Osmosis pools from the SQS REST API and normalises them to the same
// pool/token shape the orchestrator (lib/ingest.ts) feeds the verdict, so Osmosis pairs flow through
// the identical verdict/trust/export pipeline as EVM pairs — no relocated allow-list.
//
// Curation is the chain-registry (identity) + the verdict (liquidity floor / phantom guard), exactly
// as GeckoTerminal + CoinGecko + the verdict curate EVM pairs:
//   - discover: every SQS pool with exactly TWO assets whose BOTH denoms the Cosmos chain-registry
//     identifies (lib/cosmosRegistry.ts). Multi-asset pools (transmuter / stableswap) break the pair
//     abstraction and are skipped — the same call deferred for Balancer/Curve on EVM.
//   - identify: token symbol/decimals/coingeckoCoinId come from the chain-registry, giving each token
//     the cgId the (source-neutral) verdict needs to identify + canonically-key + auto-verify it.
//   - value: reserveUsd is the pool's SQS `liquidity_cap`; the USD spot price of each token comes from
//     a batched /tokens/prices call. There is no pricing subgraph to corroborate against, so
//     corroboration is fail-open (go-ooo's own price filters are the backstop).

import { cosmosAssetMap, CosmosAsset } from "./cosmosRegistry";
import { emptyPoolFacts, IngestAdapter, NormalisedPage, NormalisedPool, NormalisedToken, PoolPageRequest } from "./ingestAdapter";
import { DEFAULT_SQS_URL, fetchSqsPools, fetchSqsPrices, SqsPool, SqsPoolsFetcher, SqsPricesFetcher } from "./sqs";

// The USD denom each Cosmos chain prices against on SQS (the unit /tokens/prices quotes in) AND the
// natural pair quote. Osmosis uses the native Noble USDC. One entry per supported Cosmos chain.
const QUOTE_DENOM: Record<string, string> = {
  osmosis: "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4",
};

// USD-stablecoin coingecko ids — used only to orient a 2-asset pool so the stable is the QUOTE
// (OSMO-USDC, not USDC-OSMO), matching how a consumer queries BASE.USDC. Orientation is cosmetic; the
// canonical key (sorted cgIds) and pricing are order-independent.
const STABLE_CG_IDS = new Set(["usd-coin", "tether", "dai", "axlusdc", "first-digital-usd"]);

const num = (s: string | undefined | null): number => {
  const n = parseFloat(s ?? "");
  return Number.isFinite(n) ? n : 0;
};

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

// Orient a 2-asset pool so a USD stablecoin (when exactly one side is one) is the quote. Otherwise
// keep the pool's own asset order.
const orientPair = (d0: string, d1: string, assets: Map<string, CosmosAsset>): [string, string] => {
  const s0 = STABLE_CG_IDS.has(assets.get(d0)?.coingeckoCoinId ?? "");
  const s1 = STABLE_CG_IDS.has(assets.get(d1)?.coingeckoCoinId ?? "");
  if (s0 && !s1) {
    return [d1, d0];
  }
  return [d0, d1];
};

export const sqsAdapter: IngestAdapter = {
  kind: "cosmos",

  async poolPage(chain, dex, page, req: PoolPageRequest): Promise<NormalisedPage> {
    // SQS returns the entire pool set in one response, so page 1 ingests it and later pages are empty
    // (the orchestrator stops paginating). The source's last_page is therefore 1.
    const quoteDenom = QUOTE_DENOM[chain];
    if (page > 1 || !quoteDenom) {
      return { poolCount: 0, pools: [], tokens: new Map(), facts: emptyPoolFacts() };
    }

    const assets = await cosmosAssetMap(chain);
    const sqsUrl = req.sqsUrl || DEFAULT_SQS_URL;
    const poolsFetcher = (req.poolsFetcher as SqsPoolsFetcher | undefined) ?? fetchSqsPools;
    const pricesFetcher = (req.pricesFetcher as SqsPricesFetcher | undefined) ?? fetchSqsPrices;

    const rawPools = await poolsFetcher(sqsUrl);

    // Discovery filter: exactly two assets, both chain-registry-identified, and a real pool id.
    const candidates = rawPools.filter(
      (p) =>
        p.balances?.length === 2 &&
        !!p.chain_model?.pool_id &&
        assets.has(p.balances[0].denom) &&
        assets.has(p.balances[1].denom),
    );

    // A denom-pair can have several pools; keep the DEEPEST (the canonical venue the oracle should
    // price), keyed by the unordered denom-pair.
    const deepest = new Map<string, SqsPool>();
    for (const p of candidates) {
      const key = [p.balances[0].denom, p.balances[1].denom].sort().join("|");
      const cur = deepest.get(key);
      if (!cur || num(p.liquidity_cap) > num(cur.liquidity_cap)) {
        deepest.set(key, p);
      }
    }

    const dedup = Array.from(deepest.values());

    // Batch-price every involved denom in USD (chunked in the client).
    const denoms = new Set<string>();
    for (const p of dedup) {
      denoms.add(p.balances[0].denom);
      denoms.add(p.balances[1].denom);
    }
    const prices = await pricesFetcher(sqsUrl, Array.from(denoms), quoteDenom);

    const tokens = new Map<string, NormalisedToken>();
    const pools: NormalisedPool[] = [];
    for (const p of dedup) {
      const [baseDenom, quoteSide] = orientPair(p.balances[0].denom, p.balances[1].denom, assets);
      const baseAsset = assets.get(baseDenom) as CosmosAsset;
      const quoteAsset = assets.get(quoteSide) as CosmosAsset;
      const basePrice = prices.get(baseDenom) ?? 0;
      const quotePrice = prices.get(quoteSide) ?? 0;

      tokens.set(baseDenom, toToken(baseAsset, basePrice));
      tokens.set(quoteSide, toToken(quoteAsset, quotePrice));
      pools.push({
        poolId: String(p.chain_model?.pool_id),
        baseAddress: baseDenom,
        quoteAddress: quoteSide,
        dexId: dex,
        reserveUsd: num(p.liquidity_cap),
        volume24hUsd: p.fees_data?.volume_24h ?? 0,
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

    return { poolCount: candidates.length, pools, tokens, facts: emptyPoolFacts() };
  },

  // Cosmos has no pricing subgraph to corroborate against — fail-open (make no claim), exactly as the
  // GeckoTerminal adapter does for a custom / no-subgraph family.
  async corroborate() {
    return emptyPoolFacts();
  },
};
