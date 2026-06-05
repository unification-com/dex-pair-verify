// Shared integration-test helpers: a single PrismaClient pointed at the
// test DB + a truncate-between-tests reset.
//
// We instantiate our own client here (rather than importing import/db.js's
// internal one) so the reset path is independent of the code under test.

import { PrismaClient, Prisma } from "@prisma/client";

import { invalidateSourceCache } from "../../lib/sourceConfig";

export const testPrisma = new PrismaClient();

// --- Shared seeders for integration tests --------------------------------

let seq = 0;
export const nextAddr = (): string => `0x${(++seq).toString(16).padStart(40, "0")}`;

export type TokenOver = Partial<Prisma.TokenUncheckedCreateInput>;
export async function seedToken(over: TokenOver = {}) {
  return testPrisma.token.create({
    data: {
      chain: "eth",
      contractAddress: nextAddr(),
      symbol: "TKN",
      name: "Token",
      txCount: 1000,
      coingeckoCoinId: "",
      totalSupply: 0,
      volume24hUsd: 0,
      marketCapUsd: 0,
      decimals: 18,
      ...over,
    },
  });
}

export type PairOver = Partial<Prisma.PairUncheckedCreateInput>;
export async function seedPair(token0Id: string, token1Id: string, over: PairOver = {}) {
  return testPrisma.pair.create({
    data: {
      chain: "eth",
      dex: "uniswap_v3",
      contractAddress: nextAddr(),
      token0Id,
      token1Id,
      pair: "WETH-USDC",
      reserve0: 0,
      reserve1: 0,
      reserveNativeCurrency: 0,
      reserveUsd: 1_000_000,
      volumeUsd: 0,
      marketCapUsd: 0,
      priceChangePercentage24h: 0,
      buys24h: 0,
      sells24h: 0,
      buyers24h: 0,
      sellers24h: 0,
      volumeUsd24h: 0,
      txCount: 5000,
      token0PriceCg: 2000,
      token0PriceDex: 2000,
      token1PriceCg: 1,
      token1PriceDex: 1,
      ...over,
    },
  });
}

// Tables in FK-safe truncation order (children first). CASCADE handles the
// rest, but listing them keeps the intent explicit.
const TABLES = [
  "DuplicatePairs",
  "DuplicateTokenSymbols",
  "Pair",
  "PairStaging",
  "Token",
  "Threshold",
  "CanonicalAddress",
  "SupportedSource",
  "CandidateDexNetwork",
];

export async function resetDb(): Promise<void> {
  const list = TABLES.map((t) => `"public"."${t}"`).join(", ");
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
  // The DB-backed source registry is memoised in-process — drop it so the next
  // getSources() reloads against the freshly-reset (and per-test-seeded) DB.
  invalidateSourceCache();
}
