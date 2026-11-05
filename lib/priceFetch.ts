// lib/priceFetch.ts
// Shared subgraph price fetch for the OoO price-test. Queries a (chain, dex)'s
// subgraph for token0Price/token1Price of the given pool addresses — at the latest
// block, plus `minutes` of historical blocks when minutes > 0. Used by the admin
// /api/admin/getprices (live, any minutes) and the public, 7-day-cached
// /api/ooo/v1/prices (latest only). The subgraph URL carries the operator's own
// provider API key from env — never persisted, never returned.
import { ApolloClient, gql, InMemoryCache } from "@apollo/client";

import { chainInfo } from "./chains";
import { sqrtPriceToToken1PerToken0, uniswapPrices } from "./poolPrice";
import { FAMILY_COLLECTION } from "./schemaFamilies";
import { getSource, resolveSubgraphUrl } from "./sourceConfig";
import { hookActsOnSwaps, normaliseV4Symbol } from "./univ4";

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

// The per-pool fields per schema family (collection: lib/schemaFamilies.ts). univ2/univ3/univ4
// expose token0Price/token1Price directly; the Messari dex-amm schema exposes per-token
// lastPriceUSD on inputTokens and univ3sqrt exposes sqrtPrice + token decimals, from which the
// pair prices are derived (see the result mapping below). univ4 also selects hooks so pools whose hook
// pools (non-canonical price) can be skipped.
const UNI_PRICE_FIELDS = `token0 { id symbol } token1 { id symbol } token0Price token1Price`;
const FAMILY_FIELDS: Record<string, string> = {
  messari: `id inputTokens { id symbol lastPriceUSD }`,
  univ3sqrt: `id token0 { id symbol decimals } token1 { id symbol decimals } sqrtPrice`,
  univ4: `id hooks ${UNI_PRICE_FIELDS}`,
};

const genQuery = (family: string, addrStr: string, blockNum: number | null): string => {
  const blockArg = blockNum === null ? "" : `block: {number: ${blockNum}},`;
  const fields = FAMILY_FIELDS[family] ?? `id ${UNI_PRICE_FIELDS}`;
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
    for (const d of (result.data?.[`p${p}`] ?? []) as SubgraphPoolRow[]) {
      const row = toPoolPriceRow(chain, dex, family, d);
      if (row) prices.push(row);
    }
  }
  return { success: true, prices, error: "" };
}

type SubgraphToken = { id: string; symbol: string; decimals?: string; lastPriceUSD?: string };

// One pool/pair row as the family's query above returns it (only that family's fields are set).
export type SubgraphPoolRow = {
  id: string;
  token0?: SubgraphToken;
  token1?: SubgraphToken;
  token0Price?: string;
  token1Price?: string;
  sqrtPrice?: string;
  hooks?: string | null;
  inputTokens?: SubgraphToken[];
};

// One subgraph row as a price row in the Uniswap convention (token0Price = token0 per token1), or
// null when the pool can't be priced: a hooked v4 pool, a Messari pool missing a token price, a
// univ3sqrt pool with no price yet.
export function toPoolPriceRow(chain: string, dex: string, family: string, d: SubgraphPoolRow): PoolPriceRow | null {
  if (family === "messari") {
    // Messari prices via per-token lastPriceUSD: token1 per token0 is
    // lastPriceUSD(token0) / lastPriceUSD(token1).
    const [t0, t1] = d.inputTokens ?? [];
    const p0 = Number(t0?.lastPriceUSD);
    const p1 = Number(t1?.lastPriceUSD);
    if (!(p0 > 0) || !(p1 > 0)) return null;
    return {
      chain,
      dex,
      token0ContractAddress: t0.id,
      token0Symbol: t0.symbol,
      token1ContractAddress: t1.id,
      token1Symbol: t1.symbol,
      pairContractAddress: d.id,
      ...uniswapPrices(p0 / p1),
    };
  }
  const { token0, token1 } = d;
  if (!token0 || !token1) return null;
  if (family === "univ4" && hookActsOnSwaps(d.hooks)) {
    return null; // a hook that acts on swaps makes the price untrustworthy for the oracle
  }
  let pairPrices = { token0Price: d.token0Price ?? "", token1Price: d.token1Price ?? "" };
  if (family === "univ3sqrt") {
    const token1PerToken0 = sqrtPriceToToken1PerToken0(d.sqrtPrice ?? "0", Number(token0.decimals), Number(token1.decimals));
    if (!(token1PerToken0 > 0)) return null; // no price yet
    pairPrices = uniswapPrices(token1PerToken0);
  }
  // v4 reports native ETH as id 0x0 / symbol "ETH"; normalise it to the chain's wrapped
  // symbol so the pair lines up with the WETH.USDC form (no-op for v2/v3).
  const symbol = (t: SubgraphToken) => (family === "univ4" ? normaliseV4Symbol(chain, t.id, t.symbol) : t.symbol);
  return {
    chain,
    dex,
    token0ContractAddress: token0.id,
    token0Symbol: symbol(token0),
    token1ContractAddress: token1.id,
    token1Symbol: symbol(token1),
    pairContractAddress: d.id,
    ...pairPrices,
  };
}
