// lib/fences.ts
// Derives the UI fence checklist from a pair + its thresholds. This is the
// presentation-side mirror of evaluatePair's fence set in
// verdict-engine__lib_verdict.ts — same predicates, but it returns rows shaped
// for display (group, label, observed/threshold strings, weight, hard flag,
// human note) instead of feeding the confidence score.
//
// Where to get the inputs in the running app:
//   - pair fields come straight off PairProps (reserveUsd, txCount, token0/1…)
//   - per-token canonicalAddress / identityConfirmed / decimals / deployment
//     timestamp / CG+DEX prices are produced by the enrichment passes; thread
//     them through getServerSideProps onto the props you pass here. Until a
//     pass has run for a given input, pass `null`/`undefined` and the fence
//     renders as "skipped" (matches the engine's weight-0 skip).
//
// IMPORTANT: keep the predicates in lock-step with verdict.ts. If a fence's
// rule changes there, change it here too (they intentionally duplicate so the
// UI can explain a verdict without importing the prisma-backed engine).

import { isPhantomLiquidity } from "./phantomLiquidity";

export type FenceGroup = "Identity" | "Provenance" | "Liquidity & Activity" | "Price";

export type UiFence = {
  key: string;
  group: FenceGroup;
  label: string;
  ok: boolean | null;        // true=pass, false=fail, null=skipped (unknown input)
  observed: string;          // pre-formatted for display
  threshold: string;         // pre-formatted for display
  weight: number;            // contribution to confidence (0 when skipped)
  hard: boolean;             // hard fence: a failure auto-rejects
  hardFail?: boolean;        // liquidity specifically below the hard floor
  note: string;              // one-line human explanation
};

// Inputs the checklist needs that aren't all on PairProps yet. Make a small
// view-model in getServerSideProps and pass it in.
export type FenceTokenInput = {
  symbol: string;
  contractAddress: string;
  coingeckoCoinId: string | null;
  identityConfirmed: boolean;
  canonicalAddress: string | null;
  decimals: number;
  deploymentTimestamp: number | null; // unix seconds
  priceCg: number | null;
  priceDex: number | null;
};

export type FenceConfig = {
  minLiquidityUsd: number;
  minTxCount: number;
  minTurnoverRatio: number;
  minAgeHours: number;
  maxPriceDeviationPercent: number;
  minDecimals: number;
  maxDecimals: number;
  hardMinLiquidityUsd: number;
  autoVerifyConfidence: number;
};

export const FENCE_WEIGHTS: Record<string, number> = {
  identified: 3, canonical0: 3, canonical1: 3, factory: 2,
  liquidity: 2, txCount: 1, turnover: 1, age0: 1, age1: 1,
  decimals0: 1, decimals1: 1, price0: 2, price1: 2,
} as const;

export const GROUP_ORDER: FenceGroup[] = ["Identity", "Provenance", "Liquidity & Activity", "Price"];

// --- tiny formatters (swap for your own if you have them) ---
const usd = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return "$" + (n / 1e3).toFixed(1) + "k";
  return "$" + n.toFixed(2);
};
const short = (a: string) => (!a ? "—" : a.slice(0, 6) + "…" + a.slice(-4));
const eq = (a: string, b: string) => a.length > 0 && b.length > 0 && a.toLowerCase() === b.toLowerCase();
const ageStr = (h: number) => (h < 24 ? Math.round(h) + "h" : h < 24 * 90 ? Math.round(h / 24) + "d" : Math.round(h / 720) + "mo");

export function deriveFences(args: {
  reserveUsd: number;
  volumeUsd: number;
  txCount: number;
  token0: FenceTokenInput;
  token1: FenceTokenInput;
  pairFactoryAddress: string | null;
  canonicalFactoryAddress: string | null;
  config: FenceConfig;
  now?: number; // unix seconds, defaults to Date.now()/1000
}): UiFence[] {
  const { token0: t0, token1: t1, config: c } = args;
  const now = args.now ?? Date.now() / 1000;
  const F: UiFence[] = [];

  // Phantom liquidity: a deep-looking pool with near-zero turnover reports a
  // reserveUsd that isn't real — withhold the liquidity credit (mirrors verdict.ts).
  const phantom = isPhantomLiquidity(args.reserveUsd, args.volumeUsd, c.minLiquidityUsd);
  const effectiveReserve = phantom ? 0 : args.reserveUsd;

  // Identity
  const id0 = !!(t0.coingeckoCoinId || t0.identityConfirmed);
  const id1 = !!(t1.coingeckoCoinId || t1.identityConfirmed);
  const idCount = (id0 ? 1 : 0) + (id1 ? 1 : 0);
  F.push({
    key: "identified", group: "Identity", label: "Both tokens identified",
    ok: idCount === 2, observed: `${idCount} of 2`, threshold: "2 of 2",
    weight: FENCE_WEIGHTS.identified, hard: false,
    note: idCount === 2 ? "CoinGecko-listed or ≥2 independent sources"
      : "neither CoinGecko-listed nor independently identity-confirmed",
  });

  // Provenance: canonical address per token
  [t0, t1].forEach((tok, i) => {
    const canon = tok.canonicalAddress;
    const ok = !canon ? null : eq(tok.contractAddress, canon);
    F.push({
      key: "canonical" + i, group: "Provenance",
      label: `${tok.symbol} address matches canonical`,
      ok, observed: short(tok.contractAddress), threshold: canon ? short(canon) : "unknown",
      weight: FENCE_WEIGHTS["canonical" + i], hard: false,
      note: ok === null ? "canonical address unknown — skipped"
        : ok ? "matches CoinGecko-canonical contract" : "does NOT match canonical (possible impostor)",
    });
  });
  // Provenance: factory
  {
    const pf = args.pairFactoryAddress, cf = args.canonicalFactoryAddress;
    const ok = !pf || !cf ? null : eq(pf, cf);
    F.push({
      key: "factory", group: "Provenance", label: "Factory matches canonical",
      ok, observed: pf ? short(pf) : "unknown", threshold: cf ? short(cf) : "unknown",
      weight: FENCE_WEIGHTS.factory, hard: false,
      note: ok === null ? "pair/canonical factory unknown — skipped"
        : ok ? "deployed by the canonical DEX factory" : "deployed by a non-canonical factory",
    });
  }

  // Liquidity & Activity
  F.push({
    key: "liquidity", group: "Liquidity & Activity", label: "Liquidity meets floor",
    ok: effectiveReserve >= c.minLiquidityUsd, observed: usd(args.reserveUsd), threshold: "floor " + usd(c.minLiquidityUsd),
    weight: FENCE_WEIGHTS.liquidity, hard: false, hardFail: args.reserveUsd < c.hardMinLiquidityUsd,
    note: phantom ? "reserve looks deep but 24h turnover ≈ 0 → likely phantom liquidity (credit withheld)"
      : args.reserveUsd < c.hardMinLiquidityUsd ? `below hard floor (${usd(c.hardMinLiquidityUsd)}) → auto-reject`
      : args.reserveUsd >= c.minLiquidityUsd ? "reserve above operator floor" : "reserve below operator floor",
  });
  F.push({
    key: "txCount", group: "Liquidity & Activity", label: "Tx count meets floor",
    ok: args.txCount >= c.minTxCount, observed: String(args.txCount), threshold: "≥ " + c.minTxCount,
    weight: FENCE_WEIGHTS.txCount, hard: false, note: "lifetime swaps on the pool",
  });
  {
    const turnover = args.reserveUsd > 0 && args.volumeUsd > 0 ? args.volumeUsd / args.reserveUsd : null;
    F.push({
      key: "turnover", group: "Liquidity & Activity", label: "24h turnover",
      ok: turnover == null ? null : turnover >= c.minTurnoverRatio,
      observed: turnover == null ? "unavailable" : turnover < 0.001 ? turnover.toExponential(1) : turnover.toFixed(4),
      threshold: "≥ " + c.minTurnoverRatio,
      weight: turnover == null ? 0 : FENCE_WEIGHTS.turnover, hard: false,
      note: turnover == null ? "volume/liquidity unavailable — skipped"
        : phantom ? "near-zero turnover on a deep pool → phantom liquidity"
        : "volume ÷ liquidity (price freshness)",
    });
  }
  [t0, t1].forEach((tok, i) => {
    const known = !!tok.deploymentTimestamp && tok.deploymentTimestamp > 0;
    const ageH = known ? (now - (tok.deploymentTimestamp as number)) / 3600 : null;
    F.push({
      key: "age" + i, group: "Liquidity & Activity", label: `${tok.symbol} age ≥ ${c.minAgeHours}h`,
      ok: !known ? null : (ageH as number) >= c.minAgeHours, observed: known ? ageStr(ageH as number) : "unknown",
      threshold: "≥ " + ageStr(c.minAgeHours), weight: known ? FENCE_WEIGHTS["age" + i] : 0, hard: false,
      note: !known ? "deployment timestamp unknown — skipped" : "time since deployment",
    });
  });
  [t0, t1].forEach((tok, i) => {
    const ok = tok.decimals >= c.minDecimals && tok.decimals <= c.maxDecimals;
    F.push({
      key: "decimals" + i, group: "Liquidity & Activity", label: `${tok.symbol} decimals sane`,
      ok, observed: String(tok.decimals), threshold: `${c.minDecimals}–${c.maxDecimals}`,
      weight: FENCE_WEIGHTS["decimals" + i], hard: true,
      note: ok ? "within sane range" : "outside sane range → auto-reject",
    });
  });

  // Price
  [t0, t1].forEach((tok, i) => {
    const cg = tok.priceCg, dex = tok.priceDex;
    const avail = !!cg && !!dex && (cg as number) > 0 && (dex as number) > 0;
    const dev = avail ? (Math.abs((dex as number) - (cg as number)) / (cg as number)) * 100 : null;
    F.push({
      key: "price" + i, group: "Price", label: `${tok.symbol} CG/DEX price deviation`,
      ok: dev == null ? null : dev <= c.maxPriceDeviationPercent,
      observed: dev == null ? "unavailable" : dev.toFixed(2) + "%", threshold: "≤ " + c.maxPriceDeviationPercent + "%",
      weight: avail ? FENCE_WEIGHTS["price" + i] : 0, hard: false,
      note: dev == null ? "CG or DEX price missing — skipped" : "DEX price vs CoinGecko reference",
    });
  });

  return F;
}

// Fraction of non-skipped weight that passed — mirrors computeConfidence.
export function fenceConfidence(fences: UiFence[]): number {
  let total = 0, passed = 0;
  for (const f of fences) if (f.ok !== null) { total += f.weight; if (f.ok) passed += f.weight; }
  return total === 0 ? 0 : passed / total;
}
