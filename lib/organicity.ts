// lib/organicity.ts
// Trading-organicity summary (B4) — a wash-vs-organic DECISION-SUPPORT hint from
// data already ingested per pool: 24h buy/sell transaction counts vs the number of
// UNIQUE buyer/seller wallets, summed across a token's pools. The tell: many
// transactions from very few distinct wallets = churn / wash trading; roughly one
// distinct wallet per trade = organic. A pure function over already-stored fields,
// so it needs no fetch/storage and is trivially unit-testable.
//
// NB: a hint for the operator's manual call, never an auto-verify gate (a few
// whales day-trading a real token also churn). The numbers are shown alongside.

export type PoolTrades = { buys24h: number; sells24h: number; buyers24h: number; sellers24h: number };

export type OrganicityLabel = "organic" | "mixed" | "wash-like" | "quiet";

export type OrganicitySummary = {
  pools: number; // pools that had any 24h trade activity
  buys: number;
  sells: number;
  buyers: number; // unique buyer wallets (summed; a wallet active in N pools counts N times)
  sellers: number;
  trades: number; // buys + sells
  traders: number; // buyers + sellers
  tradersPerTrade: number | null; // traders / trades ∈ (0, 1]; null when no trades
  label: OrganicityLabel;
};

// Below this many 24h trades the ratio is too small a sample to judge — a genuine
// but quiet token (a niche project, a sleepy stable pair) must read "quiet", NOT a
// wash/organic verdict off a handful of trades. Set deliberately high because real
// wash trading is defined by HIGH transaction volume from few wallets, so a low
// ratio only carries signal once there's meaningful activity behind it.
const QUIET_TRADES = 100;
// traders/trade thresholds, calibrated against real data: active blue-chips
// (WETH/USDC/USDT) sit ~0.35–0.45 because legitimate repeat traders / arb bots
// trade many times, so "organic" must include them; genuine wash trading churns
// far fewer wallets (<0.15 ≈ 7+ trades per distinct wallet). The 0.15–0.35 middle
// is "mixed" — worth a glance, not a red flag.
const ORGANIC_RATIO = 0.35;
const WASH_RATIO = 0.15;

export function summariseOrganicity(pools: PoolTrades[]): OrganicitySummary {
  let buys = 0;
  let sells = 0;
  let buyers = 0;
  let sellers = 0;
  let withActivity = 0;
  for (const p of pools) {
    const b = p.buys24h || 0;
    const s = p.sells24h || 0;
    buys += b;
    sells += s;
    buyers += p.buyers24h || 0;
    sellers += p.sellers24h || 0;
    if (b + s > 0) {
      withActivity += 1;
    }
  }
  const trades = buys + sells;
  const traders = buyers + sellers;
  const tradersPerTrade = trades > 0 ? traders / trades : null;

  let label: OrganicityLabel;
  if (tradersPerTrade === null || trades < QUIET_TRADES) {
    label = "quiet"; // sparse 24h activity — not enough to judge, NOT a red flag
  } else if (tradersPerTrade < WASH_RATIO) {
    label = "wash-like";
  } else if (tradersPerTrade < ORGANIC_RATIO) {
    label = "mixed";
  } else {
    label = "organic";
  }

  return { pools: withActivity, buys, sells, buyers, sellers, trades, traders, tradersPerTrade, label };
}
