import { GetServerSideProps } from "next";
import React from "react";

import ChainName from "../components/ChainName";
import Layout from "../components/shell/Layout";
import DataTable, { Column } from "../components/ui/DataTable";
import PageHeader from "../components/ui/PageHeader";
import { ethAmt, num, shortHex, xfund } from "../lib/format";
import { economicsAggregates, providerBalances, type DailyPoint } from "../lib/oooEconomics";
import { operatorGate } from "../lib/operatorGate";

type Row = {
  chainId: number;
  chain: string;
  provider: string;
  fulfilments: number;
  feesPaid: string;
  ethBalance: string | null;
  withdrawableXfund: string | null;
};

type Props = {
  totalFulfilments: number;
  totalFeesPaid: string;
  totalUnclaimed: string;
  providers: number;
  rows: Row[];
  daily: DailyPoint[];
};

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const gate = await operatorGate(ctx);
  if (gate) return gate;

  const [agg, balances] = await Promise.all([economicsAggregates(30), providerBalances()]);
  const balByKey = new Map(balances.map((b) => [`${b.chainId}:${b.provider}`, b]));
  const rows: Row[] = agg.byProviderChain.map((s) => {
    const b = balByKey.get(`${s.chainId}:${s.provider}`);
    return { ...s, ethBalance: b?.ethBalance ?? null, withdrawableXfund: b?.withdrawableXfund ?? null };
  });
  const totalUnclaimed = balances.reduce((acc, b) => acc + (b.withdrawableXfund ? BigInt(b.withdrawableXfund) : BigInt(0)), BigInt(0)).toString();

  return {
    props: {
      totalFulfilments: agg.totalFulfilments,
      totalFeesPaid: agg.totalFeesPaid,
      totalUnclaimed,
      providers: agg.providers,
      rows,
      daily: agg.daily,
    },
  };
};

const Kpi: React.FC<{ label: string; value: React.ReactNode; sub?: string }> = ({ label, value, sub }) => (
  <div className="card card-pad kpi">
    <span className="kpi-label muted">{label}</span>
    <span className="kpi-value">{value}</span>
    {sub ? <span className="kpi-sub muted">{sub}</span> : null}
    <style jsx>{`
      .kpi { display: flex; flex-direction: column; gap: 2px; }
      .kpi-label { font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.04em; }
      .kpi-value { font-size: var(--fs-xl); font-weight: 600; font-family: var(--font-mono); }
      .kpi-sub { font-size: var(--fs-xs); }
    `}</style>
  </div>
);

// Lightweight inline bar chart (no chart dependency) — fulfilments per day over the window.
const DailyBars: React.FC<{ daily: DailyPoint[] }> = ({ daily }) => {
  if (daily.length === 0) return <p className="muted">No fulfilments in the last 30 days.</p>;
  const max = Math.max(...daily.map((d) => d.fulfilments), 1);
  return (
    <div className="card card-pad">
      <div className="bars">
        {daily.map((d) => (
          <div key={d.day} className="bar-col" title={`${d.day}: ${d.fulfilments} fulfilments · ${xfund(d.fees)}`}>
            <div className="bar" style={{ height: `${Math.max(3, (d.fulfilments / max) * 100)}%` }} />
            <span className="bar-x">{d.day.slice(5)}</span>
          </div>
        ))}
      </div>
      <style jsx>{`
        .bars { display: flex; align-items: flex-end; gap: 4px; height: 140px; overflow-x: auto; }
        .bar-col { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 22px; height: 100%; justify-content: flex-end; }
        .bar { width: 16px; background: var(--accent); border-radius: 3px 3px 0 0; }
        .bar-x { font-size: 9px; color: var(--text-2); white-space: nowrap; transform: rotate(-45deg); transform-origin: top left; }
      `}</style>
    </div>
  );
};

const OooEconomicsPage: React.FC<Props> = (props) => {
  const cols: Column<Row>[] = [
    { key: "chain", label: "Network", render: (r) => <ChainName chain={r.chain} /> },
    { key: "provider", label: "Provider", render: (r) => <span className="mono" title={r.provider}>{shortHex(r.provider)}</span> },
    { key: "fulfilments", label: "Fulfilments", num: true, render: (r) => num(r.fulfilments) },
    { key: "feesPaid", label: "Fees earned", num: true, render: (r) => <span className="mono">{xfund(r.feesPaid)}</span> },
    { key: "withdrawableXfund", label: "Unclaimed xFUND", num: true, render: (r) => <span className="mono">{xfund(r.withdrawableXfund)}</span> },
    { key: "ethBalance", label: "Gas balance", num: true, render: (r) => <span className="mono">{ethAmt(r.ethBalance)}</span> },
  ];

  return (
    <Layout crumb="OoO economics">
      <PageHeader title="OoO economics" sub={`${props.providers} provider${props.providers === 1 ? "" : "s"} · ${num(props.totalFulfilments)} fulfilments across all networks`} />

      <div className="kpis">
        <Kpi label="Total fulfilments" value={num(props.totalFulfilments)} />
        <Kpi label="Fees earned" value={xfund(props.totalFeesPaid, false)} sub="xFUND" />
        <Kpi label="Unclaimed in Router" value={xfund(props.totalUnclaimed, false)} sub="xFUND withdrawable" />
        <Kpi label="Providers" value={num(props.providers)} />
      </div>

      <h3 className="section">Fulfilments per day (30d)</h3>
      <DailyBars daily={props.daily} />

      <h3 className="section">By provider &amp; network</h3>
      <DataTable columns={cols} data={props.rows} rowKey={(r) => `${r.chainId}:${r.provider}`} empty="No fulfilments recorded yet." />

      <style jsx>{`
        .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--sp-4); margin-bottom: var(--sp-5); }
        .section { margin: var(--sp-5) 0 var(--sp-3); font-size: var(--fs-md); }
      `}</style>
    </Layout>
  );
};

export default OooEconomicsPage;
