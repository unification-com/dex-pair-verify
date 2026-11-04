import React from "react";

import { num as fmtNum } from "../lib/format";
import { OrganicityLabel, OrganicitySummary } from "../lib/organicity";
import KV from "./ui/KV";

const num = (n: number | null | undefined) => fmtNum(n, 0);

const TONE: Record<OrganicityLabel, { tone: string; text: string }> = {
  organic: { tone: "pass", text: "organic" },
  mixed: { tone: "warn", text: "mixed" },
  "wash-like": { tone: "fail", text: "wash-like" },
  quiet: { tone: "skip", text: "quiet (24h)" },
};

// 24h trading organicity (unique traders vs trade count, summed across the token's
// pools). Decision support, not a trust gate. Shared by the operator + public
// token detail; renders nothing when there's no trade activity to show.
const TokenOrganicity: React.FC<{ s: OrganicitySummary }> = ({ s }) => {
  if (s.trades === 0) return null;
  const meta = TONE[s.label];

  return (
    <div className="card card-pad">
      <div className="row spread items-center" style={{ marginBottom: "var(--sp-3)" }}>
        <span className="eyebrow">Trading activity (24h)</span>
        <span className={`badge badge-${meta.tone} badge-sm`}>{meta.text}</span>
      </div>
      <div className="kv-grid">
        <KV k="Buys / Sells" v={`${num(s.buys)} / ${num(s.sells)}`} />
        <KV k="Buyers / Sellers" v={`${num(s.buyers)} / ${num(s.sellers)}`} />
        <KV
          k="Unique traders per trade"
          v={s.tradersPerTrade != null ? s.tradersPerTrade.toFixed(2) : "—"}
          hint="Distinct buyer+seller wallets ÷ buy+sell transactions (0–1). Low can mean wash trading OR a small active community — a hint to look, not a verdict."
        />
        <KV k="Pools with activity" v={num(s.pools)} />
      </div>
      {s.label === "quiet" ? (
        <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: "var(--sp-3) 0 0" }}>
          Sparse 24h trading — too little to judge organicity. A quiet day is normal for a genuine niche token, not a red flag.
        </p>
      ) : null}
      <style jsx>{`
        .kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 var(--sp-7); padding-top: var(--sp-3); }
      `}</style>
    </div>
  );
};

export default TokenOrganicity;
