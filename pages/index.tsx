import { GetServerSideProps } from "next"
import Link from "next/link";
import React from "react"

import { buildPublicPairsCatalogue } from "../lib/export";

type SamplePair = { base: string; target: string; sources: number; chains: string[]; totalLiquidityUsd: number };

// PUBLIC landing — no auth. Shows what the oracle can be asked for (the public
// /api/ooo/pairs catalogue) and points operators to the gated console.
export const getServerSideProps: GetServerSideProps = async () => {
  let count = 0;
  let queryFormat = "BASE.TARGET.AD";
  let sample: SamplePair[] = [];
  try {
    const catalogue = await buildPublicPairsCatalogue();
    count = catalogue.pairs.length;
    queryFormat = catalogue.queryFormat;
    sample = catalogue.pairs.slice(0, 12).map((p) => ({
      base: p.base, target: p.target, sources: p.sources, chains: p.chains, totalLiquidityUsd: p.totalLiquidityUsd,
    }));
  } catch {
    // Landing must render even if the DB is unavailable — just show no sample.
  }
  return { props: { count, queryFormat, sample } };
}

type Props = { count: number; queryFormat: string; sample: SamplePair[] };

const usd = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return "$" + (n / 1e3).toFixed(1) + "k";
  return "$" + n.toFixed(2);
};

const Landing: React.FC<Props> = ({ count, queryFormat, sample }) => (
  <div className="landing">
    <main className="lp-main">
      <section className="lp-hero">
        <span className="eyebrow">Unification OoO · DEX pair verification</span>
        <h1>Trusted DEX pairs for OoO</h1>
        <p className="lp-lead">
          Pairs are verified — identity, canonical address, factory provenance, liquidity, scam
          signals and CG/DEX price agreement — before the OoO provider serves a price for them.
          This is the public menu of what you can query.
        </p>
        <div className="lp-cta">
          <Link href="/api/ooo/pairs"><a className="btn btn-primary">View the pairs API</a></Link>
          <span className="lp-q">Query format <code className="mono">{queryFormat}</code> — e.g. <code className="mono">WETH.USDC.AD</code></span>
        </div>
      </section>

      <section className="card card-pad lp-cat">
        <div className="row spread items-baseline">
          <span className="eyebrow">Supported pairs</span>
          <span className="mono" style={{ fontSize: "var(--fs-xl)", fontWeight: 700, color: "var(--accent-text)" }}>{count}</span>
        </div>
        <p className="muted" style={{ marginTop: "var(--sp-2)" }}>
          Canonically-distinct verified pairs, deepest liquidity first. Full machine-readable list at{" "}
          <Link href="/api/ooo/pairs"><a className="mono">/api/ooo/pairs</a></Link>.
        </p>
        {sample.length > 0 && (
          <div className="lp-grid">
            {sample.map((p) => (
              <div key={`${p.base}.${p.target}`} className="lp-pair">
                <span className="lp-sym mono">{p.base}.{p.target}</span>
                <span className="lp-meta muted">{p.sources} pool{p.sources === 1 ? "" : "s"} · {p.chains.length} chain{p.chains.length === 1 ? "" : "s"} · {usd(p.totalLiquidityUsd)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>

    <footer className="lp-foot muted">Unification · OoO pair verification</footer>

    <style jsx>{`
      .landing { min-height: 100vh; display: flex; flex-direction: column; }
      .lp-main { flex: 1; max-width: 920px; width: 100%; margin: 0 auto; padding: var(--sp-11) var(--sp-6); display: flex; flex-direction: column; gap: var(--sp-9); }
      .lp-hero h1 { font-size: var(--fs-3xl); line-height: var(--lh-tight); margin: var(--sp-4) 0; }
      .lp-lead { font-size: var(--fs-lg); color: var(--text-1); max-width: 660px; }
      .lp-cta { display: flex; align-items: center; gap: var(--sp-5); flex-wrap: wrap; margin-top: var(--sp-6); }
      .lp-q { font-size: var(--fs-sm); color: var(--text-2); }
      .lp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--sp-3); margin-top: var(--sp-5); }
      .lp-pair { display: flex; flex-direction: column; gap: 2px; padding: var(--sp-3) var(--sp-4); background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--r-md); }
      .lp-sym { font-weight: 600; }
      .lp-meta { font-size: var(--fs-xs); }
      .lp-foot { padding: var(--sp-6) var(--sp-8); border-top: 1px solid var(--border); font-size: var(--fs-xs); }
    `}</style>
  </div>
);

export default Landing;
