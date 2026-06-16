// lib/sqsAdapter.ts
// The Osmosis SQS IngestAdapter (#128 Phase 2c). It DISCOVERS Osmosis pools from the SQS REST API,
// maps each to a CosmosPoolCandidate, and hands them to the shared Cosmos curation (lib/cosmosPage.ts)
// — which identifies the tokens via the chain-registry, dedupes, orients + filters — so Osmosis pairs
// flow through the identical verdict/trust/export pipeline as EVM pairs, no relocated allow-list.
//
// SQS specifics owned here: the per-asset USD spot comes from a separate batched /tokens/prices call
// (the pool list carries reserves but not prices), and the CL-vs-CosmWasm pool-id field differs. The
// USD prices are quoted in the chain's native USDC denom. There is no pricing subgraph to corroborate
// against, so corroboration is fail-open (go-ooo's own price filters are the backstop).

import { buildCosmosPage, CosmosPoolCandidate } from "./cosmosPage";
import { cosmosAssetMap } from "./cosmosRegistry";
import { emptyPoolFacts, IngestAdapter, NormalisedPage, PoolPageRequest } from "./ingestAdapter";
import { DEFAULT_SQS_URL, fetchSqsPools, fetchSqsPrices, SqsPool, SqsPoolsFetcher, SqsPricesFetcher } from "./sqs";

// The USD denom each Cosmos chain prices against on SQS (the unit /tokens/prices quotes in). Osmosis
// uses the native Noble USDC. One entry per SQS-backed Cosmos chain.
const QUOTE_DENOM: Record<string, string> = {
  osmosis: "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4",
};

const num = (s: string | undefined | null): number => {
  const n = parseFloat(s ?? "");
  return Number.isFinite(n) ? n : 0;
};

// The on-chain pool id, reading whichever field the pool type uses (`id` for GAMM/stableswap/CL,
// `pool_id` for CosmWasm). undefined when neither is present (the pool is then skipped).
const poolIdOf = (p: SqsPool): number | undefined => p.chain_model?.id ?? p.chain_model?.pool_id;

export const sqsAdapter: IngestAdapter = {
  kind: "cosmos",

  async poolPage(chain, _dex, page, req: PoolPageRequest): Promise<NormalisedPage> {
    // SQS returns the entire pool set in one response, so page 1 ingests it and later pages are empty
    // (the orchestrator stops paginating). The source's last_page is therefore 1.
    const quoteDenom = QUOTE_DENOM[chain];
    if (page > 1 || !quoteDenom) {
      return { poolCount: 0, pools: [], tokens: new Map(), facts: emptyPoolFacts() };
    }

    const assets = await cosmosAssetMap(chain);
    const sqsUrl = req.cosmosApiUrl || DEFAULT_SQS_URL;
    const poolsFetcher = (req.poolsFetcher as SqsPoolsFetcher | undefined) ?? fetchSqsPools;
    const pricesFetcher = (req.pricesFetcher as SqsPricesFetcher | undefined) ?? fetchSqsPrices;

    const rawPools = await poolsFetcher(sqsUrl, req.minLiquidityCap ?? 0);

    // 2-asset, chain-registry-identified pools with a real pool id (skip multi-asset transmuters etc.).
    const matched = rawPools.filter(
      (p) =>
        p.balances?.length === 2 &&
        !!poolIdOf(p) &&
        assets.has(p.balances[0].denom) &&
        assets.has(p.balances[1].denom),
    );

    // Batch-price every involved denom in USD (one chunked call).
    const denoms = new Set<string>();
    for (const p of matched) {
      denoms.add(p.balances[0].denom);
      denoms.add(p.balances[1].denom);
    }
    const prices = await pricesFetcher(sqsUrl, Array.from(denoms), quoteDenom);

    const candidates: CosmosPoolCandidate[] = matched.map((p) => ({
      poolId: String(poolIdOf(p)),
      denom0: p.balances[0].denom,
      denom1: p.balances[1].denom,
      reserveUsd: num(p.liquidity_cap),
      volume24hUsd: p.fees_data?.volume_24h ?? 0,
      priceUsd0: prices.get(p.balances[0].denom) ?? 0,
      priceUsd1: prices.get(p.balances[1].denom) ?? 0,
    }));

    return { ...buildCosmosPage(assets, candidates), facts: emptyPoolFacts() };
  },

  // Cosmos has no pricing subgraph to corroborate against — fail-open (make no claim), exactly as the
  // GeckoTerminal adapter does for a custom / no-subgraph family.
  async corroborate() {
    return emptyPoolFacts();
  },
};
