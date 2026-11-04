// lib/graphUsage.ts
// Foundation The Graph usage (admin #3). PART A — the on-chain GRT billing balance, read live from the Edge &
// Node Billing contract on Arbitrum One. Queries beyond the 100k/month free tier are paid from GRT deposited
// here (userBalances), so this is the "how much paid-query runway is left" number, with the wallet's plain GRT
// + Arbitrum ETH for top-up context. PART B (queries consumed this period) has no public API — see
// project_docs/planning/dex-pair-verify/TRACKER-graph-usage.md; the dashboard links to Studio for that.
import { defaultEthCall, ethGetBalance } from "./onchain/ethCall";

// Defaults are the proven Arbitrum-One values (read-verified 2026-06-19); all env-overridable.
const ARBITRUM_RPC = process.env.GRAPH_ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc";
const BILLING = (process.env.GRAPH_BILLING_CONTRACT || "0x1B07D3344188908Fb6DEcEac381f3eE63C48477a").toLowerCase();
const GRT_TOKEN = (process.env.GRAPH_TOKEN || "0x9623063377AD1B27544C965cCd7342f7EA7e88C7").toLowerCase();
const WALLET = (process.env.GRAPH_WALLET || "0x42c1BbF9c3a2daAEc18c78eB68847693D5279968").toLowerCase();
const FREE_TIER = Number(process.env.GRAPH_FREE_TIER_QUERIES || 100_000);
const LOW_GRT = Number(process.env.GRAPH_LOW_BALANCE_GRT || 100);

// Selectors locked by graphUsage.test.ts.
export const USER_BALANCES_SELECTOR = "0x26224c64"; // userBalances(address)
export const BALANCE_OF_SELECTOR = "0x70a08231"; // balanceOf(address)

const padAddr = (a: string): string => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const hexToBigStr = (hex: string | null): string | null => (hex && hex !== "0x" ? BigInt(hex).toString() : null);

export type GraphUsage = {
  wallet: string;
  billingContract: string;
  grtDecimals: number;
  billingBalanceGrt: string | null; // deposited, spendable on queries (base units, 18 dp); null = read failed
  walletGrt: string | null; // held in the wallet, not yet deposited
  walletEthWei: string | null; // Arbitrum ETH (top-up gas)
  freeTierQueries: number;
  lowBalanceThresholdGrt: number;
};

let cache: { at: number; data: GraphUsage } | null = null;
const TTL_MS = 60_000;

async function read(): Promise<GraphUsage> {
  const [billing, walletBal, eth] = await Promise.all([
    defaultEthCall(ARBITRUM_RPC, BILLING, USER_BALANCES_SELECTOR + padAddr(WALLET)),
    defaultEthCall(ARBITRUM_RPC, GRT_TOKEN, BALANCE_OF_SELECTOR + padAddr(WALLET)),
    ethGetBalance(ARBITRUM_RPC, WALLET),
  ]);
  return {
    wallet: WALLET,
    billingContract: BILLING,
    grtDecimals: 18,
    billingBalanceGrt: hexToBigStr(billing),
    walletGrt: hexToBigStr(walletBal),
    walletEthWei: hexToBigStr(eth),
    freeTierQueries: FREE_TIER,
    lowBalanceThresholdGrt: LOW_GRT,
  };
}

export async function graphUsage(): Promise<GraphUsage> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const data = await read();
  cache = { at: Date.now(), data };
  return data;
}
