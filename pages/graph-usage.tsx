import { GetServerSideProps } from "next";
import React from "react";

import Layout from "../components/shell/Layout";
import KV from "../components/ui/KV";
import PageHeader from "../components/ui/PageHeader";
import { ageStr, ethAmt, grt, num, shortHex } from "../lib/format";
import { graphQueryUsage } from "../lib/graphQueryCounter";
import { graphUsage, type GraphUsage } from "../lib/graphUsage";
import { operatorGate } from "../lib/operatorGate";

const arbiscan = (addr: string): string => `https://arbiscan.io/address/${addr}`;

type QueryUsageView = { period: string; count: number; firstAt: number; ratePerDay: number; projectedMonthly: number };
type Props = { usage: GraphUsage; queryUsage: QueryUsageView | null };

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const gate = await operatorGate(ctx);
  if (gate) return gate;

  const [usage, q] = await Promise.all([graphUsage(), graphQueryUsage()]);
  let queryUsage: QueryUsageView | null = null;
  if (q && q.count > 0) {
    const now = Math.floor(Date.now() / 1000);
    const daysTracked = Math.max((now - q.firstAt) / 86400, 1 / 24); // ≥ 1h, so a fresh counter doesn't divide by ~0
    const ratePerDay = q.count / daysTracked;
    const d = new Date();
    const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    queryUsage = { period: q.period, count: q.count, firstAt: q.firstAt, ratePerDay: Math.round(ratePerDay), projectedMonthly: Math.round(ratePerDay * daysInMonth) };
  }
  return { props: { usage, queryUsage } };
};

const GraphUsagePage: React.FC<Props> = ({ usage: u, queryUsage: qu }) => {
  const grtNum = u.billingBalanceGrt != null ? Number(u.billingBalanceGrt) / 1e18 : null;
  const low = grtNum != null && grtNum < u.lowBalanceThresholdGrt;
  const over = qu != null && qu.projectedMonthly > u.freeTierQueries;

  return (
    <Layout crumb="Graph usage">
      <PageHeader title="The Graph usage" sub="Foundation GRT billing balance + query spend (Arbitrum One)" />

      <div className={`card card-pad balance${low ? " low" : ""}`}>
        <span className="muted" style={{ fontSize: "var(--fs-xs)", textTransform: "uppercase", letterSpacing: "0.04em" }}>GRT billing balance</span>
        <span className="big mono">{grt(u.billingBalanceGrt, false)} <span className="unit">GRT</span></span>
        <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          Deposited in the billing contract — spends down as queries exceed the {num(u.freeTierQueries)}/month free tier.
        </span>
        {low ? <span className="badge badge-warn" style={{ marginTop: 6 }}>⚠ Below {u.lowBalanceThresholdGrt} GRT — top up soon</span> : null}
      </div>

      <h3 className="section">Query usage — {num(u.freeTierQueries)}/month free tier</h3>
      {qu ? (
        <div className="card card-pad">
          <div className="usage-head">
            <span className="big mono">{num(qu.count)}</span>
            <span className="muted">queries tracked this period ({qu.period})</span>
          </div>
          <div className="bar"><div className={`bar-fill${over ? " over" : ""}`} style={{ width: `${Math.min(100, (qu.count / u.freeTierQueries) * 100)}%` }} /></div>
          <div className="stats">
            <KV k="Current rate" v={<span className="mono">~{num(qu.ratePerDay)}/day</span>} />
            <KV k="Projected this month" v={<span className={`mono${over ? " over-txt" : ""}`}>{num(qu.projectedMonthly)} / {num(u.freeTierQueries)}</span>} hint="At the current rate, extrapolated to the full calendar month" />
          </div>
          <p className="muted note-p">
            Self-tracked since {ageStr(qu.firstAt)} ago — counts <strong>dpv&apos;s</strong> Graph queries only
            (go-ooo on the same key adds more), and excludes queries before counting began this period.
            Cross-check against <a href="https://thegraph.com/studio/" target="_blank" rel="noreferrer">Subgraph Studio</a>.
            {over ? " ⚠ Projected to exceed the free tier — overage draws on the GRT balance above." : ""}
          </p>
        </div>
      ) : (
        <div className="card card-pad">
          <p className="muted note-p">No queries tracked yet this period — the counter fills on the next ingest run. Live usage is also in <a href="https://thegraph.com/studio/" target="_blank" rel="noreferrer">Subgraph Studio</a>.</p>
        </div>
      )}

      <div className="card card-pad" style={{ marginTop: "var(--sp-4)" }}>
        <KV k="Wallet (billing account)" v={<a href={arbiscan(u.wallet)} target="_blank" rel="noreferrer" className="mono">{shortHex(u.wallet)}</a>} />
        <KV k="Billing contract" v={<a href={arbiscan(u.billingContract)} target="_blank" rel="noreferrer" className="mono">{shortHex(u.billingContract)}</a>} hint="Edge & Node Billing on Arbitrum One" />
        <KV k="GRT held (not deposited)" v={<span className="mono">{grt(u.walletGrt)}</span>} hint="In the wallet, not yet added to billing" />
        <KV k="Arbitrum ETH (top-up gas)" v={<span className="mono">{ethAmt(u.walletEthWei)} ETH</span>} />
      </div>

      <style jsx>{`
        .balance { display: flex; flex-direction: column; gap: 4px; }
        .balance.low { border-color: var(--warn-line, var(--warn)); }
        .big { font-size: 2rem; font-weight: 700; }
        .unit { font-size: 1rem; color: var(--text-2); }
        .section { margin: var(--sp-5) 0 var(--sp-3); font-size: var(--fs-md); }
        .usage-head { display: flex; align-items: baseline; gap: var(--sp-3); }
        .bar { height: 10px; background: var(--bg-3); border-radius: var(--r-pill); overflow: hidden; margin: var(--sp-3) 0; }
        .bar-fill { height: 100%; background: var(--accent); border-radius: var(--r-pill); }
        .bar-fill.over { background: var(--warn); }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--sp-2) var(--sp-5); }
        .over-txt { color: var(--warn); }
        .note-p { font-size: var(--fs-sm); margin: 6px 0 0; }
      `}</style>
    </Layout>
  );
};

export default GraphUsagePage;
