import { GetServerSideProps } from "next";
import React from "react";

import Layout from "../components/shell/Layout";
import KV from "../components/ui/KV";
import PageHeader from "../components/ui/PageHeader";
import { ethAmt, grt, num, shortHex } from "../lib/format";
import { graphUsage, type GraphUsage } from "../lib/graphUsage";
import { operatorGate } from "../lib/operatorGate";

export const getServerSideProps: GetServerSideProps<{ usage: GraphUsage }> = async (ctx) => {
  const gate = await operatorGate(ctx);
  if (gate) return gate;
  return { props: { usage: await graphUsage() } };
};

const arbiscan = (addr: string): string => `https://arbiscan.io/address/${addr}`;

const GraphUsagePage: React.FC<{ usage: GraphUsage }> = ({ usage: u }) => {
  const grtNum = u.billingBalanceGrt != null ? Number(u.billingBalanceGrt) / 1e18 : null;
  const low = grtNum != null && grtNum < u.lowBalanceThresholdGrt;

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

      <div className="card card-pad" style={{ marginTop: "var(--sp-4)" }}>
        <KV k="Wallet (billing account)" v={<a href={arbiscan(u.wallet)} target="_blank" rel="noreferrer" className="mono">{shortHex(u.wallet)}</a>} />
        <KV k="Billing contract" v={<a href={arbiscan(u.billingContract)} target="_blank" rel="noreferrer" className="mono">{shortHex(u.billingContract)}</a>} hint="Edge & Node Billing on Arbitrum One" />
        <KV k="GRT held (not deposited)" v={<span className="mono">{grt(u.walletGrt)}</span>} hint="In the wallet, not yet added to billing" />
        <KV k="Arbitrum ETH (top-up gas)" v={<span className="mono">{ethAmt(u.walletEthWei)} ETH</span>} />
      </div>

      <div className="card card-pad note" style={{ marginTop: "var(--sp-4)" }}>
        <strong>Query usage this period</strong>
        <p className="muted">
          The Graph exposes query counts only in the Studio dashboard — there is no public usage API. View
          consumed/remaining queries against the {num(u.freeTierQueries)}/month free tier in{" "}
          <a href="https://thegraph.com/studio/" target="_blank" rel="noreferrer">Subgraph Studio</a>. A self-tracked
          counter in dpv&apos;s subgraph client is the planned follow-up (Part B).
        </p>
      </div>

      <style jsx>{`
        .balance { display: flex; flex-direction: column; gap: 4px; }
        .balance.low { border-color: var(--warn-line, var(--warn)); }
        .big { font-size: 2rem; font-weight: 700; }
        .unit { font-size: 1rem; color: var(--text-2); }
        .note p { margin: 6px 0 0; font-size: var(--fs-sm); }
      `}</style>
    </Layout>
  );
};

export default GraphUsagePage;
