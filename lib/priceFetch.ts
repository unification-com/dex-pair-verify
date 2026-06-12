// lib/priceFetch.ts
// Shared subgraph price fetch for the OoO price-test. Queries a (chain, dex)'s
// subgraph for token0Price/token1Price of the given pool addresses — at the latest
// block, plus `minutes` of historical blocks when minutes > 0. Used by the admin
// /api/admin/getprices (live, any minutes) and the public, 7-day-cached
// /api/ooo/v1/prices (latest only). The subgraph URL carries the operator's own
// provider API key from env — never persisted, never returned.
import { ApolloClient, gql, InMemoryCache } from "@apollo/client";

import { chainInfo } from "./chains";
import { getSource, resolveSubgraphUrl } from "./sourceConfig";
import { isHookedPool, normaliseV4Symbol } from "./univ4";

export type PoolPriceRow = {
  chain: string;
  dex: string;
  token0ContractAddress: string;
  token0Symbol: string;
  token0Price: string;
  token1ContractAddress: string;
  token1Symbol: string;
  token1Price: string;
  pairContractAddress: string;
};

export type FetchPricesResult = { success: boolean; prices: PoolPriceRow[]; error: string };

const getCurrentBlockNumber = async (rpc: string): Promise<number> => {
  const body = { jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: Math.floor(Math.random() * 1000000) + 1 };
  const res = await fetch(rpc, { method: "post", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  const json = await res.json();
  return parseInt(json.result, 16);
};

// The subgraph collection name + per-pool fields per schema family. univ2/univ3/univ4 expose
// token0Price/token1Price directly; the Messari dex-amm schema exposes per-token lastPriceUSD on
// inputTokens, from which the pair price is derived (see the result mapping below). univ4 also
// selects hooks so hooked pools (non-canonical price) can be skipped.
const FAMILY_COLLECTION: Record<string, string> = { univ2: "pairs", univ3: "pools", univ4: "pools", messari: "liquidityPools" };

const genQuery = (family: string, addrStr: string, blockNum: number | null): string => {
  const blockArg = blockNum === null ? "" : `block: {number: ${blockNum}},`;
  const fields = family === "messari"
    ? `id inputTokens { id symbol lastPriceUSD }`
    : family === "univ4"
      ? `id hooks token0 { id symbol } token1 { id symbol } token0Price token1Price`
      : `id token0 { id symbol } token1 { id symbol } token0Price token1Price`;
  return `
    ${FAMILY_COLLECTION[family]}(
      ${blockArg}
      where: { id_in: [${addrStr.toLowerCase()}] }
    ) {
      ${fields}
    }
  `;
};

// Fetch per-pool prices from the (chain, dex) subgraph. `minutes` adds that many
// minutes of historical blocks (capped at 10, or 4 on BSC). Never throws — a
// failure returns { success: false, error }.
export async function fetchPoolPrices(
  chain: string,
  dex: string,
  addresses: string[],
  minutes: number,
): Promise<FetchPricesResult> {
  if (!chain || !dex || addresses.length === 0) {
    return { success: false, prices: [], error: "chain, dex and addresses required" };
  }

  let mins = Number.isFinite(minutes) ? minutes : 0;
  if (mins > 10) mins = 10;
  if (chain === "bsc" && mins > 4) mins = 4; // BSC blocks are dense — cap the query size

  const addrStr = `"${addresses.join('","')}"`;
  const blocksPerMin = chainInfo[chain]?.blocksPerMin;
  const rpc = chainInfo[chain]?.rpc;

  // Resolve the subgraph from the DB registry. poolsName comes from the schema
  // family (univ2 → pairs, univ3 → pools); the URL is the {API_KEY} template with
  // this provider's key substituted in (operator's own key, never persisted).
  const source = await getSource(chain, dex);
  if (!source?.subgraphUrlTemplate) {
    return { success: false, prices: [], error: "could not find subgraph info" };
  }
  const family = source.subgraphSchemaFamily;
  if (!FAMILY_COLLECTION[family]) {
    return { success: false, prices: [], error: `price-test does not support the "${family}" schema family` };
  }
  const url = resolveSubgraphUrl(source);
  if (!url) {
    return { success: false, prices: [], error: "could not resolve subgraph URL" };
  }

  const client = new ApolloClient({ uri: url, cache: new InMemoryCache() });

  const qArray: string[] = [`p0: ${genQuery(family, addrStr, null)}`];
  let subBlocks = 0;
  if (mins > 0 && rpc && blocksPerMin) {
    const currentBlock = await getCurrentBlockNumber(rpc);
    const lastBlock = currentBlock - 1;
    subBlocks = mins * blocksPerMin;
    for (let p = 0; p < subBlocks; p += 1) {
      qArray.push(`p${p + 1}: ${genQuery(family, addrStr, lastBlock - p)}`);
    }
  }
  const query = gql`{ ${qArray.join(",")} }`;

  let result;
  try {
    result = await client.query({ query });
  } catch (e) {
    return { success: false, prices: [], error: String((e as { error?: string })?.error ?? e) };
  }
  if (result.errors) {
    return { success: false, prices: [], error: result.errors.map((e, i) => `${i}: ${e.message}.`).join("") };
  }

  const prices: PoolPriceRow[] = [];
  for (let p = 0; p <= subBlocks; p += 1) {
    const rows = result.data?.[`p${p}`] ?? [];
    for (const d of rows) {
      if (family === "messari") {
        // Messari prices via per-token lastPriceUSD; derive token0Price (token1 per token0) =
        // lastPriceUSD(token0) / lastPriceUSD(token1), and token1Price as its inverse.
        const toks = d.inputTokens ?? [];
        if (toks.length < 2) continue;
        const [t0, t1] = toks;
        const p0 = Number(t0.lastPriceUSD);
        const p1 = Number(t1.lastPriceUSD);
        if (!(p0 > 0) || !(p1 > 0)) continue;
        prices.push({
          chain,
          dex,
          token0ContractAddress: t0.id,
          token0Symbol: t0.symbol,
          token0Price: String(p0 / p1),
          token1ContractAddress: t1.id,
          token1Symbol: t1.symbol,
          token1Price: String(p1 / p0),
          pairContractAddress: d.id,
        });
        continue;
      }
      if (family === "univ4" && isHookedPool(d.hooks)) {
        continue; // hooked pools are not priceable for the oracle (non-canonical price)
      }
      // v4 reports native ETH as id 0x0 / symbol "ETH"; normalise it to the chain's wrapped
      // symbol so the pair lines up with the WETH.USDC form (no-op for v2/v3).
      const t0Symbol = family === "univ4" ? normaliseV4Symbol(chain, d.token0.id, d.token0.symbol) : d.token0.symbol;
      const t1Symbol = family === "univ4" ? normaliseV4Symbol(chain, d.token1.id, d.token1.symbol) : d.token1.symbol;
      prices.push({
        chain,
        dex,
        token0ContractAddress: d.token0.id,
        token0Symbol: t0Symbol,
        token0Price: d.token0Price,
        token1ContractAddress: d.token1.id,
        token1Symbol: t1Symbol,
        token1Price: d.token1Price,
        pairContractAddress: d.id,
      });
    }
  }
  return { success: true, prices, error: "" };
}
