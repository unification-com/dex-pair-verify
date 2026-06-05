// Symbol-based duplicate detection: flags tokens that share a symbol on a
// chain, and pairs that share a base-quote symbol pair on a (chain, dex).
// Populates the DuplicateTokenSymbols / DuplicatePairs tables surfaced on the
// token + pair detail pages. Run with: yarn find-duplicates

import "../lib/env";

import {
  getAllPairsForChainDex,
  getAllTokenSymbolsForChain,
  getOrAddDuplicatePair,
  getOrAddDuplicateTokenSymbol,
} from "./db";
import { getSources } from "../lib/sourceConfig";

const processTokensForChain = async (chain: string): Promise<number> => {
  console.log(chain);
  const tokens = await getAllTokenSymbolsForChain(chain);
  let duplicateCount = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    const original = tokens[i];
    for (let j = 0; j < tokens.length; j += 1) {
      const potentialDuplicate = tokens[j];
      if (original.id === potentialDuplicate.id) {
        continue;
      }
      if (original.symbol === potentialDuplicate.symbol) {
        const [, created] = await getOrAddDuplicateTokenSymbol(chain, original.id, potentialDuplicate.id);
        if (created) {
          duplicateCount += 1;
        }
      }
    }
  }

  return duplicateCount;
};

const processPairsForChain = async (chain: string, dex: string): Promise<number> => {
  console.log(chain, dex);
  let duplicateCount = 0;

  const pairs = await getAllPairsForChainDex(chain, dex);

  for (let i = 0; i < pairs.length; i += 1) {
    const original = pairs[i];
    const pairCheck0 = `${original.token0.symbol}-${original.token1.symbol}`;
    const pairCheck1 = `${original.token1.symbol}-${original.token0.symbol}`;

    for (let j = 0; j < pairs.length; j += 1) {
      const potentialDuplicate = pairs[j];
      if (original.id === potentialDuplicate.id) {
        continue;
      }
      if (pairCheck0 === potentialDuplicate.pair || pairCheck1 === potentialDuplicate.pair) {
        const [, created] = await getOrAddDuplicatePair(chain, dex, original.id, potentialDuplicate.id);
        if (created) {
          duplicateCount += 1;
        }
      }
    }
  }

  return duplicateCount;
};

const run = async (): Promise<string> => {
  console.log("Tokens");
  const duplicates: { tokens: Record<string, number>; pairs: Record<string, Record<string, number>> } = {
    tokens: {},
    pairs: {},
  };

  const sources = await getSources();
  const chains: string[] = [];
  for (const poolMeta of sources) {
    if (!chains.includes(poolMeta.chain)) {
      chains.push(poolMeta.chain);
    }
  }

  for (const chain of chains) {
    duplicates.tokens[chain] = await processTokensForChain(chain);
  }

  console.log("Pairs");
  for (const poolMeta of sources) {
    const { chain, dex } = poolMeta;
    if (duplicates.pairs[chain] === undefined) {
      duplicates.pairs[chain] = {};
    }
    duplicates.pairs[chain][dex] = await processPairsForChain(chain, dex);
  }

  console.log("New duplicates found");
  console.log(JSON.stringify(duplicates, null, 2));

  return "Done";
};

run().then(console.log);
