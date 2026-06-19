// lib/oooEconomics.ts
// OoO economics dashboard (admin #2). Two halves, both read-only:
//   1. DB aggregates over the Fulfilment table (admin #1's data) — totals, per-provider/chain breakdown,
//      and a daily time-series. feePaid is a uint256 STRING, so the sums run in Postgres via CAST(... AS
//      NUMERIC) (correct + cheap) rather than pulling every row into JS.
//   2. Live on-chain reads per (chain, provider) — the provider's gas balance and the xFUND the Router still
//      owes it (getWithdrawableTokens). Cached 60s so a page refresh doesn't re-hit every RPC.
import { defaultEthCall, ethGetBalance } from "./onchain/ethCall";
import { oooRouterForChain } from "./oooRouters";
import prisma from "./prisma";

const nowSeconds = (): number => Math.floor(Date.now() / 1000);
const hexToBigStr = (hex: string | null): string | null => (hex && hex !== "0x" ? BigInt(hex).toString() : null);

// --- DB aggregates -----------------------------------------------------------------------------------

export type ProviderChainStat = { chainId: number; chain: string; provider: string; fulfilments: number; feesPaid: string };
export type DailyPoint = { day: string; fulfilments: number; fees: string };
export type EconomicsAggregates = {
  totalFulfilments: number;
  totalFeesPaid: string; // xFUND base units
  providers: number;
  byProviderChain: ProviderChainStat[];
  daily: DailyPoint[];
};

export async function economicsAggregates(days = 30): Promise<EconomicsAggregates> {
  const cutoff = nowSeconds() - days * 86400;
  const [totals, byPC, daily] = await Promise.all([
    prisma.$queryRaw<{ n: number; fees: string; providers: number }[]>`
      SELECT COUNT(*)::int AS n,
             COALESCE(SUM(CAST("feePaid" AS NUMERIC)), 0)::text AS fees,
             COUNT(DISTINCT provider)::int AS providers
      FROM "Fulfilment" WHERE "fulfilledAt" IS NOT NULL`,
    prisma.$queryRaw<{ chainId: number; chain: string; provider: string; n: number; fees: string }[]>`
      SELECT "chainId", chain, provider,
             COUNT(*)::int AS n,
             COALESCE(SUM(CAST("feePaid" AS NUMERIC)), 0)::text AS fees
      FROM "Fulfilment"
      WHERE "fulfilledAt" IS NOT NULL AND provider IS NOT NULL
      GROUP BY "chainId", chain, provider
      ORDER BY n DESC`,
    prisma.$queryRaw<{ day: string; n: number; fees: string }[]>`
      SELECT to_char(to_timestamp("fulfilledAt"), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS n,
             COALESCE(SUM(CAST("feePaid" AS NUMERIC)), 0)::text AS fees
      FROM "Fulfilment"
      WHERE "fulfilledAt" IS NOT NULL AND "fulfilledAt" >= ${cutoff}
      GROUP BY day ORDER BY day`,
  ]);
  const t = totals[0] ?? { n: 0, fees: "0", providers: 0 };
  return {
    totalFulfilments: t.n,
    totalFeesPaid: t.fees,
    providers: t.providers,
    byProviderChain: byPC.map((r) => ({ chainId: r.chainId, chain: r.chain, provider: r.provider, fulfilments: r.n, feesPaid: r.fees })),
    daily: daily.map((r) => ({ day: r.day, fulfilments: r.n, fees: r.fees })),
  };
}

// --- live balances (cached) --------------------------------------------------------------------------

// getWithdrawableTokens(address) → uint256. Selector locked by oooEconomics.test.ts.
export const WITHDRAWABLE_SELECTOR = "0x38dcb96f";

export type ProviderBalance = {
  chainId: number;
  chain: string;
  provider: string;
  ethBalance: string | null; // wei (decimal string); null = read failed (RPC down)
  withdrawableXfund: string | null; // xFUND base units (decimal string); null = read failed
};

let balanceCache: { at: number; data: ProviderBalance[] } | null = null;
const BALANCE_TTL_MS = 60_000;

async function readBalances(): Promise<ProviderBalance[]> {
  // The (chain, provider) set is exactly who has fulfilled — drive the live reads off the DB so a chain with
  // no activity is never queried.
  const groups = await prisma.fulfilment.groupBy({ by: ["chainId", "chain", "provider"], where: { provider: { not: null } } });
  return Promise.all(
    groups.map(async (g): Promise<ProviderBalance> => {
      const provider = g.provider as string;
      const router = oooRouterForChain(g.chainId);
      if (!router) return { chainId: g.chainId, chain: g.chain, provider, ethBalance: null, withdrawableXfund: null };
      const data = WITHDRAWABLE_SELECTOR + provider.replace(/^0x/, "").toLowerCase().padStart(64, "0");
      const [eth, wd] = await Promise.all([ethGetBalance(router.rpc, provider), defaultEthCall(router.rpc, router.router, data)]);
      return { chainId: g.chainId, chain: g.chain, provider, ethBalance: hexToBigStr(eth), withdrawableXfund: hexToBigStr(wd) };
    }),
  );
}

export async function providerBalances(): Promise<ProviderBalance[]> {
  if (balanceCache && Date.now() - balanceCache.at < BALANCE_TTL_MS) return balanceCache.data;
  const data = await readBalances();
  balanceCache = { at: Date.now(), data };
  return data;
}
