import { GetServerSideProps } from "next"
import Link from "next/link";
import { useRouter } from "next/router";
import React from "react";

import ChainName from "../components/ChainName";
import StatCard from "../components/dashboard/StatCard";
import DexName from "../components/DexName";
import Layout from "../components/shell/Layout";
import ConfidenceMeter from "../components/ui/ConfidenceMeter";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import { isOperatorCtx } from "../lib/operatorGate";
import prisma from "../lib/prisma";
import { VERIFIED_STATUSES } from "../lib/status";
import { TokenPairStatus } from "../types/types";

type Step = { href: string; step?: string; label: string; what: string };
type TopRow = { id: string; pair: string; chain: string; dex: string; reserveUsd: number; confidence: number | null };
type SourceRow = { chain: string; dex: string; count: number };

// The verification pipeline, in the order it should be run after a fresh ingest.
const PIPELINE: Step[] = [
  { href: "/ingest", step: "1", label: "Ingest", what: "Pull pairs from GeckoTerminal and run the verdict inline. Run first — after a fresh dump, or to refresh market data. Seeds the per-(chain,dex) thresholds on first run." },
  { href: "/identitycheck", step: "2", label: "Identity check", what: "Resolve identity for tokens with no CoinGecko id (token lists + GoPlus positive signals) and promote genuine pairs out of Needs Review. Run before Scam Check. GoPlus-paced." },
  { href: "/canonicalcheck", step: "3", label: "Canonical check", what: "Resolve each token's CoinGecko-canonical contract and route address-mismatch impostors to Needs Review. CoinGecko-paced." },
  { href: "/factorycheck", step: "4", label: "Factory check", what: "Read each pool's on-chain factory() and route pools not deployed by the canonical DEX factory to Needs Review. RPC — quick." },
  { href: "/scancheck", step: "5", label: "Scam check", what: "GoPlus security checks (honeypot, extreme tax, hidden owner…); demote flagged pairs to Needs Review. Run last. GoPlus-paced." },
];

const MAINTENANCE: Step[] = [
  { href: "/thresholds", label: "Thresholds", what: "Per-(chain, dex) verdict thresholds — liquidity floors, min 24h trades, turnover, confidence band, decimals. Tune here, then Re-validate to apply." },
  { href: "/revalidate", label: "Re-validate", what: "Re-run the verdict across every pair (e.g. after changing thresholds). Fast — no external API calls." },
];

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  // Public visitors get a read-only verified-data overview — no review queue, no
  // operator internals.
  if (!(await isOperatorCtx(ctx))) {
    const [verifiedPairs, verifiedTokens, supported, verifiedSourceGroups] = await Promise.all([
      prisma.pair.count({ where: { status: { in: [...VERIFIED_STATUSES] } } }),
      prisma.token.count({ where: { status: { in: [...VERIFIED_STATUSES] } } }),
      prisma.supportedSource.findMany({ select: { chain: true, dex: true }, orderBy: [{ chain: 'asc' }, { dex: 'asc' }] }),
      prisma.pair.groupBy({ by: ['chain', 'dex'], where: { status: { in: [...VERIFIED_STATUSES] } }, _count: { _all: true } }),
    ]);
    const sources: SourceRow[] = verifiedSourceGroups
      .map((g) => ({ chain: g.chain, dex: g.dex, count: g._count._all }))
      .sort((a, b) => b.count - a.count);
    const networks = Array.from(new Set(supported.map((s) => s.chain))).length;
    return { props: { isOperator: false, verifiedPairs, verifiedTokens, supportedCount: supported.length, networks, sources } };
  }

  const [statusGroups, tierGroups, topReview, sourceGroups] = await Promise.all([
    prisma.pair.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.pair.groupBy({ by: ['reviewTier'], where: { status: TokenPairStatus.NeedsReview }, _count: { _all: true } }),
    prisma.pair.findMany({
      where: { status: TokenPairStatus.NeedsReview },
      orderBy: [{ reserveNativeCurrency: 'desc' }],
      take: 8,
      select: { id: true, pair: true, chain: true, dex: true, reserveUsd: true, confidence: true },
    }),
    prisma.pair.groupBy({ by: ['chain', 'dex'], _count: { _all: true } }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const g of statusGroups) statusCounts[g.status] = g._count._all;
  const tierCounts: Record<string, number> = {};
  for (const g of tierGroups) if (g.reviewTier) tierCounts[g.reviewTier] = g._count._all;
  const sources: SourceRow[] = sourceGroups
    .map((g) => ({ chain: g.chain, dex: g.dex, count: g._count._all }))
    .sort((a, b) => b.count - a.count);

  return { props: { isOperator: true, statusCounts, tierCounts, topReview, sources } };
}

type OperatorProps = {
  isOperator: true;
  statusCounts: Record<string, number>;
  tierCounts: Record<string, number>;
  topReview: TopRow[];
  sources: SourceRow[];
};
type PublicProps = {
  isOperator: false;
  verifiedPairs: number;
  verifiedTokens: number;
  supportedCount: number;
  networks: number;
  sources: SourceRow[];
};
type Props = OperatorProps | PublicProps;

const usd = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return "$" + (n / 1e3).toFixed(1) + "k";
  return "$" + n.toFixed(2);
};

const AdminHome: React.FC<OperatorProps> = (props) => {
  const router = useRouter();
  const sc = props.statusCounts;
  const verified = (sc[TokenPairStatus.AutoVerified] ?? 0) + (sc[TokenPairStatus.ManualVerified] ?? 0);

  return (
    <Layout crumb="Dashboard">
      <PageHeader title="Operator dashboard" sub="What needs your attention, and the pipeline that feeds it." />

      <div className="stat-row">
        <StatCard label="Needs review" value={sc[TokenPairStatus.NeedsReview] ?? 0} icon="queue" accent onClick={() => router.push("/pairs?status=NeedsReview")} />
        <StatCard label="Likely spam" value={props.tierCounts.spam ?? 0} tone="fail" icon="alert" onClick={() => router.push("/pairs?status=NeedsReview&tier=spam")} />
        <StatCard label="Worth a look" value={props.tierCounts.review ?? 0} tone="warn" icon="search" onClick={() => router.push("/pairs?status=NeedsReview&tier=review")} />
        <StatCard label="Verified" value={verified} tone="pass" icon="check" onClick={() => router.push("/pairs?status=AutoVerified")} />
        <StatCard label="Auto-rejected" value={sc[TokenPairStatus.AutoRejected] ?? 0} tone="fail" icon="x" onClick={() => router.push("/pairs?status=AutoRejected")} />
      </div>

      <div className="home-grid">
        <div className="card card-pad">
          <div className="row spread items-center" style={{ marginBottom: "var(--sp-4)" }}>
            <span className="eyebrow">Top of the review queue</span>
            <Link href="/pairs?status=NeedsReview"><a className="btn btn-ghost btn-sm">Open queue <Icon name="arrowR" size={14} /></a></Link>
          </div>
          {props.topReview.length === 0
            ? <p className="muted">Nothing awaiting review 🎉</p>
            : props.topReview.map((p) => (
              <div key={p.id} className="qrow" onClick={() => router.push(`/p/${p.id}?status=NeedsReview`)} role="button">
                <span className="qr-pair">{p.pair}</span>
                <span className="qr-src muted"><ChainName chain={p.chain} /> · <DexName dex={p.dex} /></span>
                <span className="grow" />
                <span className="mono qr-res">{usd(p.reserveUsd)}</span>
                <span className="qr-conf"><ConfidenceMeter value={p.confidence} compact /></span>
                <Icon name="chevR" size={14} />
              </div>
            ))}
        </div>

        <div className="card card-pad">
          <span className="eyebrow">Sources</span>
          <div className="src-list">
            {props.sources.map((s) => (
              <div key={`${s.chain}_${s.dex}`} className="srow">
                <span className="sr-name"><ChainName chain={s.chain} /> · <DexName dex={s.dex} /></span>
                <span className="muted mono">{s.count}</span>
                <span className="grow" />
                <Link href={`/pairs?chain=${encodeURIComponent(s.chain)}&dex=${encodeURIComponent(s.dex)}&status=NeedsReview`}><a className="link-sm">Pairs</a></Link>
                <Link href={`/tokens?chain=${encodeURIComponent(s.chain)}`}><a className="link-sm">Tokens</a></Link>
                <Link href={`/api/ooo/export?chain=${encodeURIComponent(s.chain)}&dex=${encodeURIComponent(s.dex)}&download=1`}><a className="link-sm">Export</a></Link>
              </div>
            ))}
          </div>
        </div>
      </div>

      <span className="eyebrow" style={{ marginTop: "var(--sp-8)", display: "block" }}>Pipeline</span>
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

      <style jsx>{`
        .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--sp-4); margin-bottom: var(--sp-6); }
        .home-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: var(--sp-5); align-items: start; }
        .qrow { display: flex; align-items: center; gap: var(--sp-4); padding: var(--sp-3) var(--sp-2); border-bottom: 1px solid var(--border); cursor: pointer; }
        .qrow:last-child { border-bottom: 0; }
        .qrow:hover { background: var(--bg-3); }
        .qr-pair { font-weight: 600; }
        .qr-src { font-size: var(--fs-xs); }
        .qr-res { font-size: var(--fs-sm); }
        .src-list { display: flex; flex-direction: column; margin-top: var(--sp-3); }
        .srow { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3) 0; border-bottom: 1px solid var(--border); font-size: var(--fs-sm); }
        .srow:last-child { border-bottom: 0; }
        .link-sm { font-size: var(--fs-xs); }
        .flow { display: flex; align-items: stretch; gap: var(--sp-3); flex-wrap: wrap; margin-top: var(--sp-3); }
        .step { flex: 1 1 200px; min-width: 200px; display: block; }
        .step:hover { border-color: var(--accent-line); }
        .step-head { display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-3); }
        .step-no { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: var(--r-pill); background: var(--accent-dim); color: var(--accent-text); font-family: var(--font-mono); font-size: var(--fs-xs); font-weight: 600; }
        .step-label { font-weight: 600; }
        .step-what { font-size: var(--fs-xs); margin: 0; line-height: var(--lh-base); }
        .flow-arrow { align-self: center; color: var(--text-3); }
        .maint { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-4); margin-top: var(--sp-3); }
        @media (max-width: 1024px) { .home-grid { grid-template-columns: 1fr; } }
        @media (max-width: 720px) { .maint { grid-template-columns: 1fr; } .flow-arrow { display: none; } }
      `}</style>
    </Layout>
  );
};

// Public read-only overview — verified-data summary, no review queue / internals.
const PublicHome: React.FC<PublicProps> = (props) => (
  <Layout crumb="Overview">
    <PageHeader
      title="Trusted DEX pairs for OoO"
      sub="The verified DEX pairs, tokens and sources that feed Unification's on-chain oracle (OoO). Read-only — operators log in for the review tools."
    />
    <div className="pub-stats">
      <StatCard label="Verified pairs" value={props.verifiedPairs} tone="pass" icon="check" />
      <StatCard label="Verified tokens" value={props.verifiedTokens} icon="token" />
      <StatCard label="Supported sources" value={props.supportedCount} icon="layers" />
      <StatCard label="Networks" value={props.networks} icon="home" />
    </div>
    <div className="card card-pad" style={{ marginTop: "var(--sp-5)" }}>
      <span className="eyebrow">Sources — verified pairs per (chain · DEX)</span>
      <div className="pub-src">
        {props.sources.map((s) => (
          <div key={`${s.chain}_${s.dex}`} className="pub-srow">
            <span><ChainName chain={s.chain} /> · <DexName dex={s.dex} /></span>
            <span className="grow" />
            <span className="muted mono">{s.count}</span>
          </div>
        ))}
      </div>
    </div>
    <p className="muted" style={{ marginTop: "var(--sp-5)", fontSize: "var(--fs-sm)" }}>
      Query these pairs on-chain via OoO — see the{" "}
      <a href="https://docs.unification.io/ooo/guide/ooo_api.html" target="_blank" rel="noreferrer">OoO API docs</a>.
    </p>
    <style jsx>{`
      .pub-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--sp-4); }
      .pub-src { display: flex; flex-direction: column; margin-top: var(--sp-3); }
      .pub-srow { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3) 0; border-bottom: 1px solid var(--border); font-size: var(--fs-sm); }
      .pub-srow:last-child { border-bottom: 0; }
    `}</style>
  </Layout>
);

function Home(props: Props) {
  if (props.isOperator) {
    return <AdminHome {...(props as OperatorProps)} />;
  }
  return <PublicHome {...(props as PublicProps)} />;
}

export default Home;
