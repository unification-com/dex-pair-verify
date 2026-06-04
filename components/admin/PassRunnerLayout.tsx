// components/admin/PassRunnerLayout.tsx
// Shared layout for all 7 admin/* enrichment-pass pages. Each pass page keeps
// its OWN run logic (the fetch loop / pacing in e.g. identitycheck.tsx) and
// passes the live state in as props. This component only renders the consistent
// chrome: title + description, the trigger button, a live progress block, and a
// "last run" summary. Right rail shows the run-order list.
//
// Usage (inside the existing page, replacing its markup — NOT its run() logic):
//   <PassRunnerLayout step={2} title="Identity check (token lists + GoPlus)"
//     description={<>…</>} pace="GoPlus free-tier 30/min"
//     running={running} done={done}
//     onRun={run} progressPct={pct}
//     stats={[{label:"Checked",value:processed},{label:"Confirmed",value:confirmed},{label:"Promoted",value:promoted}]}
//     lastRun="26h ago" lastResult="210 checked · 38 confirmed" stale />
import Link from "next/link";
import React, { ReactNode } from "react";

import Icon from "../ui/Icon";

const PASSES = [
  { step: 1, name: "Ingest", href: "/admin/ingest" },
  { step: 2, name: "Identity", href: "/admin/identitycheck" },
  { step: 3, name: "Canonical", href: "/admin/canonicalcheck" },
  { step: 4, name: "Factory", href: "/admin/factorycheck" },
  { step: 5, name: "Scam", href: "/admin/scancheck" },
  { step: 6, name: "Re-validate", href: "/admin/revalidate" },
];

type Stat = { label: string; value: ReactNode; tone?: string };

const PassRunnerLayout: React.FC<{
  step: number;
  title: string;
  description: ReactNode;
  pace?: string;
  running: boolean;
  done: boolean;
  onRun: () => void;
  progressPct?: number;      // 0..100; omit for indeterminate passes
  stats?: Stat[];            // live counters
  lastRun?: string;
  lastResult?: string;
  stale?: boolean;
}> = ({ step, title, description, pace, running, done, onRun, progressPct, stats = [], lastRun, lastResult, stale }) => (
  <div className="content">
    <Link href="/admin"><a className="btn btn-ghost btn-sm" style={{ marginBottom: "var(--sp-5)" }}><Icon name="chevL" size={14} />Back to pipeline</a></Link>
    <div className="row gap-5 items-baseline" style={{ marginBottom: "var(--sp-2)" }}>
      <span className="pass-step">{step}</span><h1>{title}</h1>
    </div>
    <p className="sub muted" style={{ maxWidth: 720, marginBottom: "var(--sp-7)" }}>{description}</p>

    <div className="pd-grid">
      <div className="col gap-7">
        <div className="card pass-card">
          <div className="row spread">
            <span className="panel-title">Run this pass</span>
            {pace ? <span className="chip"><Icon name="clock" size={12} />{pace}</span> : null}
          </div>
          <div className="row gap-5">
            <button className="btn btn-primary btn-lg" disabled={running} onClick={onRun}>
              <Icon name={running ? "clock" : "play"} size={15} />{running ? "Running…" : done ? "Run again" : "Start pass"}
            </button>
            {done ? <span className="badge badge-pass"><span className="glyph">✓</span>done</span> : null}
          </div>
          {(running || done) ? (
            <div className="pass-prog">
              {progressPct != null ? <>
                <div className="row spread"><span className="muted">{running ? "Processing…" : "Complete"}</span><span className="mono tnum" style={{ fontWeight: 600 }}>{Math.round(progressPct)}%</span></div>
                <div className="meter"><i style={{ width: progressPct + "%", background: done ? "var(--pass)" : "var(--accent)" }} /></div>
              </> : <div className="muted">{running ? "Processing…" : "Complete"}</div>}
              {stats.length ? <div className="row gap-6" style={{ marginTop: "var(--sp-3)", flexWrap: "wrap" }}>
                {stats.map((s, i) => <span key={i} className="metric"><span className="m-label">{s.label}</span><span className="m-value" style={s.tone ? { color: `var(--${s.tone})` } : undefined}>{s.value}</span></span>)}
              </div> : null}
            </div>
          ) : null}
        </div>

        {(lastRun || lastResult) ? (
          <div className="card card-pad">
            <div className="panel-title" style={{ marginBottom: "var(--sp-5)" }}>Last run</div>
            <div className="row gap-6 wrap">
              {lastRun ? <span className="metric"><span className="m-label">When</span><span className="m-value">{lastRun}</span></span> : null}
              {lastResult ? <span className="metric" style={{ flex: 1 }}><span className="m-label">Result</span><span className="m-value" style={{ fontSize: "var(--fs-md)" }}>{lastResult}</span></span> : null}
              <span className="metric"><span className="m-label">State</span><span className={`badge badge-sm ${stale ? "badge-warn" : "badge-pass"}`} style={{ marginTop: 2 }}>{stale ? "stale" : "fresh"}</span></span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="pd-rail">
        <div className="card card-pad col gap-4">
          <span className="panel-title">Run order</span>
          {PASSES.map((p) => (
            <Link key={p.step} href={p.href}><a className={`fresh-row${p.step === step ? " is-current" : ""}`}>
              <span className="pass-step" style={{ width: 20, height: 20, fontSize: 10 }}>{p.step}</span>
              <span style={{ fontWeight: p.step === step ? 600 : 500, color: p.step === step ? "var(--accent-text)" : "var(--text-1)" }}>{p.name}</span>
            </a></Link>
          ))}
        </div>
      </div>
    </div>
  </div>
);

export default PassRunnerLayout;
