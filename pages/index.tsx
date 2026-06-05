import { GetServerSideProps } from "next"
import Link from "next/link";
import { useRouter } from "next/router";
import React from "react"

import ChainName from "../components/ChainName";
import StatCard from "../components/dashboard/StatCard";
import DexName from "../components/DexName";
import Layout from "../components/shell/Layout"
import ConfidenceMeter from "../components/ui/ConfidenceMeter";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import prisma from '../lib/prisma';
import { TokenPairStatus } from "../types/types";

type TopRow = { id: string; pair: string; chain: string; dex: string; reserveUsd: number; confidence: number | null };
type SourceRow = { chain: string; dex: string; count: number };

export const getServerSideProps: GetServerSideProps = async () => {
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

  return { props: { statusCounts, tierCounts, topReview, sources } };
}

type Props = {
  statusCounts: Record<string, number>;
  tierCounts: Record<string, number>;
  topReview: TopRow[];
  sources: SourceRow[];
}

const usd = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return "$" + (n / 1e3).toFixed(1) + "k";
  return "$" + n.toFixed(2);
};

const Home: React.FC<Props> = (props) => {
  const router = useRouter();
  const sc = props.statusCounts;
  const verified = (sc[TokenPairStatus.AutoVerified] ?? 0) + (sc[TokenPairStatus.ManualVerified] ?? 0);

  return (
    <Layout crumb="Home">
      <PageHeader title="Operator home" sub="What needs your attention" />

      <div className="stat-row">
        <StatCard label="Needs review" value={sc[TokenPairStatus.NeedsReview] ?? 0} icon="queue" accent
          onClick={() => router.push("/list-pairs?status=NeedsReview")} />
        <StatCard label="Likely spam" value={props.tierCounts.spam ?? 0} tone="fail" icon="alert"
          onClick={() => router.push("/list-pairs?status=NeedsReview&tier=spam")} />
        <StatCard label="Worth a look" value={props.tierCounts.review ?? 0} tone="warn" icon="search"
          onClick={() => router.push("/list-pairs?status=NeedsReview&tier=review")} />
        <StatCard label="Verified" value={verified} tone="pass" icon="check"
          onClick={() => router.push("/list-pairs?status=AutoVerified")} />
        <StatCard label="Auto-rejected" value={sc[TokenPairStatus.AutoRejected] ?? 0} tone="fail" icon="x"
          onClick={() => router.push("/list-pairs?status=AutoRejected")} />
      </div>

      <div className="home-grid">
        <div className="card card-pad">
          <div className="row spread items-center" style={{ marginBottom: "var(--sp-4)" }}>
            <span className="eyebrow">Top of the review queue</span>
            <Link href="/list-pairs?status=NeedsReview"><a className="btn btn-ghost btn-sm">Open queue <Icon name="arrowR" size={14} /></a></Link>
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
                <Link href={`/list-pairs?chain=${encodeURIComponent(s.chain)}&dex=${encodeURIComponent(s.dex)}&status=NeedsReview`}><a className="link-sm">Pairs</a></Link>
                <Link href={`/list-tokens?chain=${encodeURIComponent(s.chain)}`}><a className="link-sm">Tokens</a></Link>
                <Link href={`/api/ooo/export?chain=${encodeURIComponent(s.chain)}&dex=${encodeURIComponent(s.dex)}&download=1`}><a className="link-sm">Export</a></Link>
              </div>
            ))}
          </div>
        </div>
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
        @media (max-width: 1024px) { .home-grid { grid-template-columns: 1fr; } }
      `}</style>
    </Layout>
  )
}

export default Home
