// lib/astroportAdapter.ts
// The Astroport (Neutron) IngestAdapter (#128). It DISCOVERS pools from the Astroport REST API and
// hands them to the shared Cosmos curation (lib/cosmosPage.ts), so Neutron pairs flow through the same
// verdict/trust/export pipeline as Osmosis + EVM pairs. Astroport's API is richer than SQS — each
// pool's assets carry priceUSD inline and the pool carries totalLiquidityUSD + real dayVolumeUSD — so
// poolPage is mostly mapping, with no separate prices call. Only clean 2-asset AMM pool types are
// kept; transmuter / staking adapters are skipped (degenerate or non-trading).

import { AstroportPool, AstroportPoolsFetcher, DEFAULT_ASTROPORT_URL, fetchAstroportPools } from "./astroport";
import { buildCosmosPage, CosmosPoolCandidate } from "./cosmosPage";
import { cosmosAssetMap } from "./cosmosRegistry";
import { emptyPoolFacts, IngestAdapter, NormalisedPage, PoolPageRequest } from "./ingestAdapter";

// The Cosmos chain id Astroport is queried by, per our internal chain key.
const ASTROPORT_CHAIN_ID: Record<string, string> = {
  neutron: "neutron-1",
};

// Clean 2-asset AMM pool types whose spot price an oracle can trust. Excluded: transmuter (1:1 peg
// bridge), sv_adapter + pair_xastro (staking adapters) — degenerate or non-trading as price feeds.
const PRICEABLE_POOL_TYPES = new Set([
  "xyk",
  "concentrated",
  "stable",
  "concentrated_duality_orderbook",
  "astroport-pair-xyk-sale-tax",
]);

export const astroportAdapter: IngestAdapter = {
  kind: "cosmos",

  async poolPage(chain, _dex, page, req: PoolPageRequest): Promise<NormalisedPage> {
    const chainId = ASTROPORT_CHAIN_ID[chain];
    // The API returns the whole pool set in one response → page 1 ingests it, later pages are empty.
    if (page > 1 || !chainId) {
      return { poolCount: 0, pools: [], tokens: new Map(), facts: emptyPoolFacts() };
    }

    const assets = await cosmosAssetMap(chain);
    const apiUrl = req.cosmosApiUrl || DEFAULT_ASTROPORT_URL;
    const poolsFetcher = (req.poolsFetcher as AstroportPoolsFetcher | undefined) ?? fetchAstroportPools;

    const rawPools = await poolsFetcher(apiUrl, chainId);

    // Active, clean-AMM, 2-asset pools → CosmosPoolCandidate (each asset's priceUSD is inline, so no
    // separate prices call). The shared builder then identifies via the chain-registry + dedupes +
    // orients + drops junk.
    const candidates: CosmosPoolCandidate[] = rawPools
      .filter(
        (p: AstroportPool) =>
          !p.isDeregistered && PRICEABLE_POOL_TYPES.has(p.poolType) && p.assets?.length === 2 && !!p.poolAddress,
      )
      .map((p) => ({
        poolId: p.poolAddress,
        denom0: p.assets[0].denom,
        denom1: p.assets[1].denom,
        reserveUsd: p.totalLiquidityUSD,
        volume24hUsd: p.dayVolumeUSD,
        priceUsd0: p.assets[0].priceUSD,
        priceUsd1: p.assets[1].priceUSD,
      }));

    return { ...buildCosmosPage(assets, candidates), facts: emptyPoolFacts() };
  },

  // Cosmos has no pricing subgraph to corroborate against — fail-open (make no claim).
  async corroborate() {
    return emptyPoolFacts();
  },
};
