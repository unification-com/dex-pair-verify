// Per-chain metadata. Single source of truth shared across the app:
//  - chainInfo: RPC endpoint + blocks/min (used by the price-test path, and the
//    T2 on-chain factory read to come).
//  - EVM chain id: shared by GoPlus (scam + identity checks) and token-list
//    membership (T1).
// (Converted from chains.js — the TS-only directive — keeping the chainInfo
//  export intact for its existing consumers.)

export type ChainInfo = { rpc: string; blocksPerMin: number };

export const chainInfo: Record<string, ChainInfo> = {
  eth: {
    rpc: "https://rpc.mevblocker.io",
    blocksPerMin: 5,
  },
  polygon_pos: {
    rpc: "https://polygon-rpc.com",
    blocksPerMin: 12,
  },
  bsc: {
    rpc: "https://bsc-dataseed.binance.org",
    blocksPerMin: 20,
  },
  xdai: {
    rpc: "https://rpc.gnosischain.com",
    blocksPerMin: 12,
  },
};

// EVM numeric chain id per our internal chain key. null = not an EVM chain we
// map (e.g. qom), so EVM-keyed lookups are skipped for it.
export const EVM_CHAIN_ID: Record<string, number | null> = {
  eth: 1,
  bsc: 56,
  polygon_pos: 137,
  xdai: 100,
  qom: null,
};

export const evmChainId = (chain: string): number | null => EVM_CHAIN_ID[chain] ?? null;

// The chains we have an EVM id for — used to scope batch queries.
export const EVM_SUPPORTED_CHAINS: string[] = Object.keys(EVM_CHAIN_ID).filter(
  (chain) => EVM_CHAIN_ID[chain] !== null,
);
