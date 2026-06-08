// lib/firstParty.ts
// First-party (Unification) token allowlist. These are OUR tokens — FUND, xFUND
// (the OoO/VOR fee token) and FUNDx — across their ERC-20 deployments. Source of
// truth: https://docs.unification.io/mainchain/networks/erc20_ibc.html (mainnets).
//
// They must always be in the oracle feed, so:
//   - the TARGETED first-party ingest pulls EVERY pool for these addresses (the
//     page-based ingest only takes the top-ranked pools per DEX, so it missed most
//     of FUND's pools — GeckoTerminal had 17 FUND/eth pools, 1 was ingested);
//   - the first-party IDENTITY source confirms them unconditionally (CoinGecko only
//     knows FUND's eth address, so Polygon fxFUND etc. would otherwise be unidentified
//     and their pairs would stall in review).
//
// A first-party pair still only auto-verifies if the OTHER token + the pool are
// legitimate (we don't want FUND priced against a scam) — identity ≠ blind verify.
//
// Shibarium entries are DORMANT: Shibarium isn't a supported chain yet, and its
// only FUND pools are effectively dead (best ~$90 reserve), so onboarding it isn't
// worth it for now. They stay listed for when that changes; `evmChainId` gates them
// out of the active ingest until Shibarium is plumbed in.

import { evmChainId } from "./chains";

export type FirstPartyToken = { chain: string; address: string; symbol: string };

export const FIRST_PARTY_TOKENS: FirstPartyToken[] = [
  // FUND (Unification's main token)
  { chain: "eth", address: "0xe9B076B476D8865cDF79D1Cf7DF420EE397a7f75", symbol: "FUND" },
  { chain: "polygon_pos", address: "0x1f0145eaC900d75808510190dFC293A09c7A964F", symbol: "fxFUND" },
  { chain: "shibarium", address: "0xaDA0fA1f9A4Ea8513B3b607EFD31792336c09507", symbol: "FUND" }, // dormant
  // xFUND (OoO / VOR fee token)
  { chain: "eth", address: "0x892A6f9dF0147e5f079b0993F486F9acA3c87881", symbol: "xFUND" },
  { chain: "polygon_pos", address: "0x77a3840f78e4685afaf9c416b36e6eae6122567b", symbol: "xFUND" },
  { chain: "shibarium", address: "0x89dc93C6c12CaE47aCAf4aD9305d7A442C30dBB2", symbol: "xFUND" }, // dormant
  // FUNDx
  { chain: "eth", address: "0x479347DfD0Be56f2a5F7bB1506bFD7AB24d4BA26", symbol: "FUNDx" },
  { chain: "polygon_pos", address: "0xf1e073d53AF781966F23B1a3B2D9E67cbbA69B92", symbol: "fxFUNDx" },
];

// Lower-cased (chain, address) set for O(1) membership.
const firstPartyKey = (chain: string, address: string): string => `${chain}:${address.toLowerCase()}`;
const firstPartySet = new Set(FIRST_PARTY_TOKENS.map((t) => firstPartyKey(t.chain, t.address)));

export function isFirstParty(chain: string, address: string): boolean {
  return firstPartySet.has(firstPartyKey(chain, address));
}

// First-party tokens on a chain we currently ingest (excludes dormant Shibarium,
// which has no EVM-chain mapping until it's onboarded).
export const ingestableFirstParty = (): FirstPartyToken[] =>
  FIRST_PARTY_TOKENS.filter((t) => evmChainId(t.chain) !== null);
