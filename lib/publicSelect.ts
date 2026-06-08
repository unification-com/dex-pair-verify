// lib/publicSelect.ts
// Single source of truth for the Prisma columns that are safe to serialise to an
// anonymous visitor. getServerSideProps ships the ENTIRE props object into the
// page's __NEXT_DATA__ (and /_next/data/*.json) regardless of what the component
// actually renders — so a public gSSP branch that returns an un-`select`-ed Prisma
// row leaks every column, including the verdict drivers (confidence,
// verdictEvidence, reviewTier, canonicalKey, factoryAddress), the scam internals
// (isScamFlagged, scamReason, goPlusData, honeypotData) and the identity/security
// signals. A TypeScript prop type does NOT constrain the runtime row — only a
// Prisma `select` does. These allow-lists enumerate ONLY the fields the public
// read-only views render, so an attacker can't read the scoring inputs back out of
// the page and use them to game a verdict.
//
// `Prisma.validator` keeps the literal field types (and fails the build if a field
// name drifts from the schema), so the selects stay honest as the models evolve.

import { Prisma } from "@prisma/client";

// Pair detail (/p/[id]) — status + symbols + the shared market-data boxes. No
// verdict / confidence / fence / trust internals.
export const publicPairDetailSelect = Prisma.validator<Prisma.PairSelect>()({
  id: true,
  chain: true,
  dex: true,
  contractAddress: true,
  pair: true,
  status: true,
  verificationMethod: true,
  reserveUsd: true,
  reserve0: true,
  reserve1: true,
  reserveNativeCurrency: true,
  volumeUsd: true,
  volumeUsd24h: true,
  marketCapUsd: true,
  txCount: true,
  token0PriceCg: true,
  token1PriceCg: true,
  priceChangePercentage24h: true,
  buys24h: true,
  sells24h: true,
  buyers24h: true,
  sellers24h: true,
  token0: { select: { symbol: true, id: true, contractAddress: true, txCount: true, status: true, coingeckoCoinId: true } },
  token1: { select: { symbol: true, id: true, contractAddress: true, txCount: true, status: true, coingeckoCoinId: true } },
});

// Pair list (/pairs) — name + the two headline market facts the table renders.
// The list never renders the token sub-rows, so they're not selected.
export const publicPairListSelect = Prisma.validator<Prisma.PairSelect>()({
  id: true,
  chain: true,
  dex: true,
  pair: true,
  reserveUsd: true,
  txCount: true,
  status: true,
});

// A pool row UNDER a token (/t/[id]) — drives the verified-pools table and the
// organicity hint (the four 24h buy/sell counts). No confidence / verdict internals.
export const publicPairLiteSelect = Prisma.validator<Prisma.PairSelect>()({
  id: true,
  pair: true,
  dex: true,
  status: true,
  reserveUsd: true,
  volumeUsd24h: true,
  txCount: true,
  buys24h: true,
  sells24h: true,
  buyers24h: true,
  sellers24h: true,
});

// Token detail (/t/[id]) scalar fields. Includes the write-through-cached
// webPresence (public website/socials data) + its stamp, which the page's
// enrichment reads/refreshes — both are non-sensitive. No scam / identity / GoPlus
// internals.
export const publicTokenDetailSelect = Prisma.validator<Prisma.TokenSelect>()({
  id: true,
  chain: true,
  contractAddress: true,
  symbol: true,
  name: true,
  status: true,
  verificationMethod: true,
  coingeckoCoinId: true,
  coinmarketcapSlug: true,
  decimals: true,
  deploymentTimestamp: true,
  webPresence: true,
  webPresenceCheckedAt: true,
});

// Token list (/tokens) — identity columns only. The pool-derived aggregates
// (liquidity / pool count) are computed separately; the scam columns are
// operator-only and deliberately absent here.
export const publicTokenListSelect = Prisma.validator<Prisma.TokenSelect>()({
  id: true,
  symbol: true,
  name: true,
  chain: true,
  coingeckoCoinId: true,
  status: true,
});

// Pools for the OoO price-test (/price-test/*). Applied to BOTH the operator and
// public paths: a price simulation needs market facts + the pool address + the two
// token FK ids, never the verdict internals — and the public path must not leak
// them. Kept here so the "what may a price-test pool expose" answer lives in one place.
export const priceTestPairSelect = Prisma.validator<Prisma.PairSelect>()({
  id: true,
  chain: true,
  dex: true,
  contractAddress: true,
  pair: true,
  reserveUsd: true,
  txCount: true,
  buys24h: true,
  sells24h: true,
  token0Id: true,
  token1Id: true,
});
