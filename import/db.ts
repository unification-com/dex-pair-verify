// Find-or-create Prisma helpers shared by the integration tests and the
// find_duplicates maintenance script. The coingecko/dex hydrate + staging
// helpers that the retired import scripts used have been pruned — lib/ingest.ts
// hydrates directly now.

import { DuplicatePairs, DuplicateTokenSymbols, Pair, PairStaging, PrismaClient, Threshold, Token } from "@prisma/client";
import { utils as web3Utils } from "web3";

import { TokenPairStatus, VerificationMethod } from "../types/types";

const prisma = new PrismaClient();

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export const getOrAddStagingPair = async (
  chain: string,
  dex: string,
  contractAddress: string,
  token0Address: string,
  token1Address: string,
): Promise<[PairStaging, boolean]> => {
  let created = false;
  let pairDb = await prisma.pairStaging.findFirst({
    where: { contractAddress: web3Utils.toChecksumAddress(contractAddress), chain, dex },
  });

  if (pairDb === null) {
    pairDb = await prisma.pairStaging.create({
      data: {
        chain,
        dex,
        contractAddress: web3Utils.toChecksumAddress(contractAddress),
        token0Address: web3Utils.toChecksumAddress(token0Address),
        token1Address: web3Utils.toChecksumAddress(token1Address),
      },
    });
    created = true;
  }

  return [pairDb, created];
};

export const getOrAddToken = async (
  chain: string,
  contractAddress: string,
  name: string,
  symbol: string,
  txCount: number | string,
  status: TokenPairStatus,
  verificationMethod: VerificationMethod,
): Promise<[Token, boolean]> => {
  let created = false;
  let token = await prisma.token.findFirst({
    where: { chain, contractAddress: web3Utils.toChecksumAddress(contractAddress) },
  });

  if (token === null) {
    token = await prisma.token.create({
      data: {
        chain,
        contractAddress: web3Utils.toChecksumAddress(contractAddress),
        name,
        symbol,
        txCount: parseInt(String(txCount), 10),
        status,
        verificationMethod,
        coingeckoCoinId: "",
        totalSupply: 0,
        volume24hUsd: 0,
        marketCapUsd: 0,
        lastChecked: 0,
        decimals: 0,
        verificationComment: "",
        createdAt: nowSeconds(),
      },
    });
    created = true;
  }

  return [token, created];
};

export const getOrAddPair = async (
  chain: string,
  dex: string,
  contractAddress: string,
  pair: string,
  t0Id: string,
  t1Id: string,
  reserveUsd: number | string,
  reserveNativeCurrency: number | string,
  reserve0: number | string,
  reserve1: number | string,
  volumeUsd: number | string,
  txCount: number | string,
  status: TokenPairStatus,
  verificationMethod: VerificationMethod,
): Promise<[Pair, boolean]> => {
  let created = false;
  let pairDb = await prisma.pair.findFirst({
    where: { contractAddress: web3Utils.toChecksumAddress(contractAddress), chain, dex },
  });

  if (pairDb === null) {
    pairDb = await prisma.pair.create({
      data: {
        chain,
        dex,
        contractAddress: web3Utils.toChecksumAddress(contractAddress),
        reserveUsd: parseFloat(String(reserveUsd)),
        volumeUsd: parseFloat(String(volumeUsd)),
        txCount: parseInt(String(txCount), 10),
        reserveNativeCurrency: parseFloat(String(reserveNativeCurrency)),
        reserve0: parseFloat(String(reserve0)),
        reserve1: parseFloat(String(reserve1)),
        status,
        pair,
        verificationMethod,
        marketCapUsd: 0,
        priceChangePercentage24h: 0,
        buys24h: 0,
        sells24h: 0,
        buyers24h: 0,
        sellers24h: 0,
        volumeUsd24h: 0,
        lastChecked: 0,
        token0PriceCg: 0,
        token0PriceDex: 0,
        token1PriceCg: 0,
        token1PriceDex: 0,
        verificationComment: "",
        createdAt: nowSeconds(),
        token0: { connect: { id: t0Id } },
        token1: { connect: { id: t1Id } },
      },
    });
    created = true;
  }

  return [pairDb, created];
};

export const getAllTokenSymbolsForChain = async (chain: string) =>
  prisma.token.findMany({
    select: { id: true, symbol: true, chain: true },
    where: { chain },
  });

export const getAllPairsForChainDex = async (chain: string, dex: string) =>
  prisma.pair.findMany({
    where: { chain, dex },
    include: {
      token0: { select: { symbol: true } },
      token1: { select: { symbol: true } },
    },
  });

export const getOrAddDuplicateTokenSymbol = async (
  chain: string,
  originalTokenId: string,
  duplicateTokenId: string,
): Promise<[DuplicateTokenSymbols, boolean]> => {
  let created = false;
  let duplicate = await prisma.duplicateTokenSymbols.findFirst({
    where: { chain, originalTokenId, duplicateTokenId },
  });

  if (duplicate === null) {
    duplicate = await prisma.duplicateTokenSymbols.create({
      data: { chain, originalTokenId, duplicateTokenId },
    });
    created = true;
  }

  return [duplicate, created];
};

export const getOrAddDuplicatePair = async (
  chain: string,
  dex: string,
  originalPairId: string,
  duplicatePairId: string,
): Promise<[DuplicatePairs, boolean]> => {
  let created = false;
  let duplicate = await prisma.duplicatePairs.findFirst({
    where: { chain, dex, originalPairId, duplicatePairId },
  });

  if (duplicate === null) {
    duplicate = await prisma.duplicatePairs.create({
      data: { chain, dex, originalPairId, duplicatePairId },
    });
    created = true;
  }

  return [duplicate, created];
};

export const getOrCreateEmptyThresholds = async (
  chain: string,
  dex: string,
): Promise<[Threshold, boolean]> => {
  let created = false;
  let thresholds = await prisma.threshold.findFirst({ where: { chain, dex } });

  if (thresholds === null) {
    thresholds = await prisma.threshold.create({
      data: { chain, dex, minLiquidityUsd: 0, minTxCount: 0 },
    });
    created = true;
  }

  return [thresholds, created];
};
