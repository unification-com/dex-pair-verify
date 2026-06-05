import { GetServerSideProps } from "next"
import Link from "next/link";
import { useRouter } from "next/router";
import React from "react";

import StatCard from "../../components/dashboard/StatCard";
import Layout from "../../components/shell/Layout";
import Icon from "../../components/ui/Icon";
import PageHeader from "../../components/ui/PageHeader";
import prisma from "../../lib/prisma";
import { TokenPairStatus } from "../../types/types";

type Step = { href: string; step?: string; label: string; what: string };

// The verification pipeline, in the order it should be run after a fresh ingest.
// Each pass is idempotent, cached and resumable, and re-runs the verdict inline,
// so you can stop and inspect between any of them.
const PIPELINE: Step[] = [
  { href: "/admin/ingest", step: "1", label: "Ingest", what: "Pull pairs from GeckoTerminal and run the verdict inline. Run first — after a fresh dump, or to refresh market data. Seeds the per-(chain,dex) thresholds on first run." },
  { href: "/admin/identitycheck", step: "2", label: "Identity check", what: "Resolve identity for tokens with no CoinGecko id (reputable token lists + GoPlus positive signals) and promote genuine pairs out of Needs Review. Run before Scam Check. GoPlus-paced — slow on a first full run." },
  { href: "/admin/canonicalcheck", step: "3", label: "Canonical check", what: "Resolve each token's CoinGecko-canonical contract address and route address-mismatch impostors to Needs Review. CoinGecko-paced." },
  { href: "/admin/factorycheck", step: "4", label: "Factory check", what: "Read each pool's on-chain factory() and route pools not deployed by the canonical DEX factory to Needs Review. RPC — quick." },
  { href: "/admin/scancheck", step: "5", label: "Scam check", what: "GoPlus security checks (honeypot, extreme tax, hidden owner…); demote flagged pairs to Needs Review. Run last so it covers everything verified. GoPlus-paced." },
];

const MAINTENANCE: Step[] = [
  { href: "/admin/thresholds", label: "Thresholds", what: "Per-(chain, dex) verdict thresholds — liquidity floors, min 24h trades, turnover, confidence band, decimals. Tune here, then Re-validate to apply." },
  { href: "/admin/revalidate", label: "Re-validate", what: "Re-run the verdict across every pair (e.g. after changing thresholds). Fast — no external API calls, no rate limits." },
];

export const getServerSideProps: GetServerSideProps = async () => {
  const groups = await prisma.pair.groupBy({ by: ['status'], _count: { _all: true } });
  const statusCounts: Record<string, number> = {};
  for (const g of groups) statusCounts[g.status] = g._count._all;
  return { props: { statusCounts } };
}

type Props = { statusCounts: Record<string, number> };

const AdminHome: React.FC<Props> = ({ statusCounts: sc }) => {
  const router = useRouter();
  const verified = (sc[TokenPairStatus.AutoVerified] ?? 0) + (sc[TokenPairStatus.ManualVerified] ?? 0);

  return (
    <Layout crumb="Pipeline">
      <PageHeader
        title="Verification pipeline"
        sub="Run the passes in order after an ingest — each is idempotent, cached and resumable, and re-runs the verdict inline."
      />

      <div className="stat-row">
        <StatCard label="Needs review" value={sc[TokenPairStatus.NeedsReview] ?? 0} icon="queue" accent onClick={() => router.push("/list-pairs?status=NeedsReview")} />
        <StatCard label="Verified" value={verified} tone="pass" icon="check" onClick={() => router.push("/list-pairs?status=AutoVerified")} />
        <StatCard label="Auto-rejected" value={sc[TokenPairStatus.AutoRejected] ?? 0} tone="fail" icon="x" onClick={() => router.push("/list-pairs?status=AutoRejected")} />
        <StatCard label="Unverified" value={sc[TokenPairStatus.Unverified] ?? 0} tone="info" icon="dash" onClick={() => router.push("/list-pairs?status=Unverified")} />
      </div>

      <span className="eyebrow">Pipeline</span>
      <div className="flow">
        {PIPELINE.map((s, i) => (
          <React.Fragment key={s.href}>
            <Link href={s.href}>
              <a className="card card-pad step">
                <div className="step-head"><span className="step-no">{s.step}</span><span className="step-label">{s.label}</span></div>
                <p className="step-what muted">{s.what}</p>
              </a>
            </Link>
            {i < PIPELINE.length - 1 ? <span className="flow-arrow"><Icon name="arrowR" size={16} /></span> : null}
          </React.Fragment>
        ))}
      </div>

      <span className="eyebrow" style={{ marginTop: "var(--sp-6)", display: "block" }}>Tuning &amp; maintenance</span>
      <div className="maint">
        {MAINTENANCE.map((s) => (
          <Link key={s.href} href={s.href}>
            <a className="card card-pad step">
              <div className="step-head"><span className="step-label">{s.label}</span></div>
              <p className="step-what muted">{s.what}</p>
            </a>
          </Link>
        ))}
      </div>

      <p className="muted" style={{ marginTop: "var(--sp-6)", fontSize: "var(--fs-sm)" }}>
        Steps 2 and 5 call GoPlus (free tier 30/min) and step 3 calls CoinGecko, so first full runs are slow;
        each pass shows how many remain. Set <code>GECKO_API_KEY</code> in <code>.env</code> to lift the CoinGecko ceiling.
      </p>

      <style jsx>{`
        .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--sp-4); margin-bottom: var(--sp-7); }
        .flow { display: flex; align-items: stretch; gap: var(--sp-3); flex-wrap: wrap; margin-top: var(--sp-3); }
        .step { flex: 1 1 200px; min-width: 200px; display: block; }
        .step:hover { border-color: var(--accent-line); }
        .step-head { display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-3); }
        .step-no { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: var(--r-pill); background: var(--accent-dim); color: var(--accent-text); font-family: var(--font-mono); font-size: var(--fs-xs); font-weight: 600; }
        .step-label { font-weight: 600; }
        .step-what { font-size: var(--fs-xs); margin: 0; line-height: var(--lh-base); }
        .flow-arrow { align-self: center; color: var(--text-3); }
        .maint { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-4); margin-top: var(--sp-3); }
        @media (max-width: 720px) { .maint { grid-template-columns: 1fr; } .flow-arrow { display: none; } }
      `}</style>
    </Layout>
  );
};

export default AdminHome;
