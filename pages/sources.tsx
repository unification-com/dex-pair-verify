// pages/sources.tsx
// Public: a read-only listing of the supported DEX subgraph sources (go-ooo's
// source of truth — chain, dex, schema family, provider, factory, verified-pair
// count). Operator: the candidate review console — lists Pending
// CandidateDexNetwork rows (from `yarn discover`), and for each lets the operator
// paste a subgraph URL → Verify (lib/subgraphVerify via /api/admin/verifysource)
// → confirm the operational fields → Promote into SupportedSource, or Reject
// (D4). GeckoTerminal gives only id+name per dex (Q1), so the subgraph URL +
// factory address are operator-supplied here. The literal API key is never
// persisted — Verify returns the {API_KEY} template, and only that template is
// promoted.
import { GetServerSideProps } from "next";
import Link from "next/link";
import React, { useState } from "react";
import { NotificationManager } from "react-notifications";

import ChainName from "../components/ChainName";
import StatCard from "../components/dashboard/StatCard";
import DexName from "../components/DexName";
import Layout from "../components/shell/Layout";
import PageHeader from "../components/ui/PageHeader";
import { usd } from "../lib/format";
import { isOperatorCtx } from "../lib/operatorGate";
import prisma from "../lib/prisma";
import { decentralizedTemplate, seedForGt } from "../lib/sourceSeeds";
import { VERIFIED_STATUSES } from "../lib/status";
import { CandidateStatus } from "../types/types";

type Candidate = {
  id: string;
  chain: string;
  dex: string;
  source: string;
  subgraphUrlTemplate: string | null;
  subgraphSchemaFamily: string | null;
  factoryAddress: string | null;
  firstSeen: number;
};

type Supported = {
  id: string;
  chain: string;
  dex: string;
  subgraphProvider: string;
  subgraphSchemaFamily: string;
  factoryAddress: string;
  lastVerifiedAt: number;
  enabledAt: number;
};

// A supported source plus its verified-pair count, for the public listing.
type PublicSource = {
  id: string;
  chain: string;
  dex: string;
  subgraphProvider: string;
  subgraphSchemaFamily: string;
  factoryAddress: string;
  lastVerifiedAt: number;
  pairCount: number;
};

const SCHEMA_FAMILIES = ["univ2", "univ3", "univ4", "messari", "custom"];

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const operator = await isOperatorCtx(ctx);

  // Public: just the supported sources + their verified-pair counts. No
  // candidates, no discover/promote/verify machinery.
  if (!operator) {
    const [supported, pairGroups] = await Promise.all([
      prisma.supportedSource.findMany({
        orderBy: [{ chain: "asc" }, { dex: "asc" }],
        select: {
          id: true,
          chain: true,
          dex: true,
          subgraphProvider: true,
          subgraphSchemaFamily: true,
          factoryAddress: true,
          lastVerifiedAt: true,
        },
      }),
      prisma.pair.groupBy({ by: ["chain", "dex"], where: { status: { in: [...VERIFIED_STATUSES] } }, _count: { _all: true } }),
    ]);
    const countMap: Record<string, number> = {};
    for (const g of pairGroups) countMap[`${g.chain}:${g.dex}`] = g._count._all;
    const sources: PublicSource[] = supported.map((s) => ({ ...s, pairCount: countMap[`${s.chain}:${s.dex}`] ?? 0 }));
    const networks = new Set(supported.map((s) => s.chain)).size;
    const totalPairs = sources.reduce((a, r) => a + r.pairCount, 0);
    return { props: { isOperator: false, sources, networks, totalPairs } };
  }

  const [candidates, supported] = await Promise.all([
    prisma.candidateDexNetwork.findMany({
      where: { status: CandidateStatus.Pending },
      orderBy: [{ chain: "asc" }, { dex: "asc" }],
      select: {
        id: true,
        chain: true,
        dex: true,
        source: true,
        subgraphUrlTemplate: true,
        subgraphSchemaFamily: true,
        factoryAddress: true,
        firstSeen: true,
      },
    }),
    prisma.supportedSource.findMany({
      orderBy: [{ chain: "asc" }, { dex: "asc" }],
      select: {
        id: true,
        chain: true,
        dex: true,
        subgraphProvider: true,
        subgraphSchemaFamily: true,
        factoryAddress: true,
        lastVerifiedAt: true,
        enabledAt: true,
      },
    }),
  ]);

  return { props: { isOperator: true, candidates, supported } };
};

type OperatorProps = { isOperator: true; candidates: Candidate[]; supported: Supported[] };
type PublicProps = { isOperator: false; sources: PublicSource[]; networks: number; totalPairs: number };
type Props = OperatorProps | PublicProps;

type FormState = {
  url: string;
  chain: string;
  dex: string;
  factoryAddress: string;
  schemaFamily: string;
  apiKeyEnvVar: string;
  seeded: boolean; // pre-filled from the curated catalogue (lib/sourceSeeds)
  seedNote: string | null; // catalogue caveat (e.g. "Solidly — not priceable yet")
  // Filled by Verify:
  provider: string;
  template: string;
  keyEnvVar: string | null;
  live: boolean | null; // null = not yet verified
  queryFields: string[];
  verifyError: string | null;
  // Real-query data probe (filled by Verify):
  dataApplicable: boolean | null;
  dataOk: boolean | null;
  sampleReserveUsd: number | null;
  rowCount: number;
  samples: { id: string; price: number | null; reserve: number | null }[];
  dataError: string | null;
  // Transient flags:
  verifying: boolean;
  busy: boolean;
};

const fmtDate = (s: number): string => (s > 0 ? new Date(s * 1000).toISOString().slice(0, 10) : "—");

// Compact a token0Price sample for display (magnitude varies wildly across pairs).
const fmtPrice = (n: number | null): string => (n == null ? "—" : n >= 1 ? n.toFixed(4) : n.toPrecision(4));

// Read-only supported-sources listing for the public.
const PublicSources: React.FC<PublicProps> = (props) => (
  <Layout crumb="Sources">
    <PageHeader
      title="Supported sources"
      sub="The DEX subgraph sources that feed Unification's OoO oracle. Each verified pair is queried on-chain via the OoO API from one of these sources."
    />

    <div className="stat-row">
      <StatCard label="Sources" value={props.sources.length} icon="layers" />
      <StatCard label="Networks" value={props.networks} icon="home" />
      <StatCard label="Verified pairs" value={props.totalPairs} tone="pass" icon="check" />
    </div>

    <div className="card card-pad" style={{ marginTop: "var(--sp-5)" }}>
      <span className="eyebrow">Sources ({props.sources.length})</span>
      {props.sources.length === 0 ? (
        <p className="muted" style={{ marginTop: "var(--sp-3)" }}>No sources configured yet.</p>
      ) : (
        <div className="src-tbl" style={{ marginTop: "var(--sp-3)" }}>
          <div className="src-head">
            <span>Chain</span>
            <span>DEX</span>
            <span>Schema</span>
            <span>Provider</span>
            <span>Factory</span>
            <span>Verified pairs</span>
          </div>
          {props.sources.map((s) => (
            <div key={s.id} className="src-row">
              <span><ChainName chain={s.chain} /></span>
              <span><DexName dex={s.dex} /></span>
              <span><span className="badge badge-neutral badge-sm">{s.subgraphSchemaFamily}</span></span>
              <span className="muted">{s.subgraphProvider}</span>
              <span className="mono truncate" title={s.factoryAddress}>{s.factoryAddress}</span>
              <span>
                <Link href={`/pairs?chain=${encodeURIComponent(s.chain)}&dex=${encodeURIComponent(s.dex)}`}><a className="mono">{s.pairCount}</a></Link>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>

    <p className="muted" style={{ marginTop: "var(--sp-5)", fontSize: "var(--fs-sm)" }}>
      Query these pairs on-chain via OoO — see the{" "}
      <a href="https://docs.unification.io/ooo/guide/ooo_api.html" target="_blank" rel="noreferrer">OoO API docs</a>.
    </p>

    <style jsx>{`
      .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--sp-4); }
      .src-tbl { display: flex; flex-direction: column; font-size: var(--fs-sm); }
      .src-head, .src-row { display: grid; grid-template-columns: 1.2fr 1.4fr 0.8fr 1.4fr 2fr 1fr; gap: var(--sp-3); align-items: center; padding: var(--sp-2) 0; }
      .src-head { color: var(--text-3); font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid var(--border); }
      .src-row { border-bottom: 1px solid var(--border); }
      .src-row:last-child { border-bottom: 0; }
    `}</style>
  </Layout>
);

const OperatorSources: React.FC<OperatorProps> = (initial) => {
  const [candidates, setCandidates] = useState<Candidate[]>(initial.candidates);
  const [supported, setSupported] = useState<Supported[]>(initial.supported);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);

  const open = (c: Candidate) => {
    setOpenId(c.id);
    // Pre-fill from the curated catalogue when this candidate is a recognised
    // target (matched by GT network+dex slug): the subgraph URL, factory, schema
    // family and internal ids all come pre-populated, so promotion is verify-and-go.
    const seed = seedForGt(c.chain, c.dex);
    setForm({
      url: seed ? decentralizedTemplate(seed.subgraphId) : "",
      chain: seed ? seed.chain : c.chain,
      dex: seed ? seed.dex : c.dex,
      factoryAddress: seed ? seed.factoryAddress : c.factoryAddress ?? "",
      schemaFamily: seed ? seed.schemaFamily : c.subgraphSchemaFamily ?? "univ2",
      apiKeyEnvVar: "",
      seeded: !!seed,
      seedNote: seed?.note ?? (seed && !seed.priceable ? "Not priceable by go-ooo yet" : null),
      provider: "",
      template: "",
      keyEnvVar: null,
      live: null,
      queryFields: [],
      verifyError: null,
      dataApplicable: null,
      dataOk: null,
      sampleReserveUsd: null,
      rowCount: 0,
      samples: [],
      dataError: null,
      verifying: false,
      busy: false,
    });
  };

  const close = () => {
    setOpenId(null);
    setForm(null);
  };

  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));

  async function verify() {
    if (!form) return;
    if (!form.url.trim()) {
      NotificationManager.warning("Paste a subgraph URL first", "", 3000);
      return;
    }
    set({ verifying: true, verifyError: null });
    try {
      const res = await fetch("/api/admin/verifysource", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: form.url.trim() }),
      }).then((r) => r.json());

      if (!res.success) {
        set({ verifying: false, verifyError: res.err || "verification failed" });
        return;
      }
      set({
        verifying: false,
        provider: res.provider,
        template: res.template,
        keyEnvVar: res.keyEnvVar,
        live: res.live,
        // Pre-fill the family from the probe; operator can still override.
        schemaFamily: res.schemaFamily && res.schemaFamily !== "custom" ? res.schemaFamily : form.schemaFamily,
        queryFields: res.queryFields || [],
        verifyError: res.error || null,
        dataApplicable: res.dataApplicable ?? null,
        dataOk: res.dataOk ?? null,
        sampleReserveUsd: res.sampleReserveUsd ?? null,
        rowCount: res.rowCount ?? 0,
        samples: res.samples ?? [],
        dataError: res.dataError ?? null,
      });
      if (res.live && res.dataOk) {
        NotificationManager.success("Live + returning data", `${res.provider} · ${res.schemaFamily}`, 3500);
      } else if (res.live) {
        NotificationManager.warning("Live, but the data query did not return usable rows", res.dataError || "", 5000);
      } else {
        NotificationManager.warning("Probe did not confirm liveness", res.error || "", 5000);
      }
    } catch (e) {
      set({ verifying: false, verifyError: String(e) });
    }
  }

  async function promote() {
    if (!form || !openId) return;
    set({ busy: true });
    try {
      const res = await fetch("/api/admin/sourcecandidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "promote",
          candidateId: openId,
          chain: form.chain.trim(),
          dex: form.dex.trim(),
          subgraphUrlTemplate: form.template,
          subgraphProvider: form.provider,
          subgraphSchemaFamily: form.schemaFamily,
          factoryAddress: form.factoryAddress.trim(),
          apiKeyEnvVar: form.apiKeyEnvVar.trim(),
        }),
      }).then((r) => r.json());

      if (!res.success) {
        set({ busy: false });
        NotificationManager.error("Could not promote", res.err || "", 6000);
        return;
      }
      NotificationManager.success("Promoted", `${form.chain}/${form.dex} is now a supported source`, 4000);
      setSupported((prev) =>
        [...prev.filter((s) => !(s.chain === res.data.chain && s.dex === res.data.dex)), res.data].sort((a, b) =>
          a.chain === b.chain ? a.dex.localeCompare(b.dex) : a.chain.localeCompare(b.chain),
        ),
      );
      setCandidates((prev) => prev.filter((c) => c.id !== openId));
      close();
    } catch (e) {
      set({ busy: false });
      NotificationManager.error("Could not promote", String(e), 6000);
    }
  }

  async function reject(c: Candidate) {
    const res = await fetch("/api/admin/sourcecandidate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", candidateId: c.id }),
    }).then((r) => r.json());

    if (res.success) {
      NotificationManager.info("Rejected", `${c.chain}/${c.dex} dismissed — discovery won't re-surface it`, 3500);
      setCandidates((prev) => prev.filter((x) => x.id !== c.id));
      if (openId === c.id) close();
    } else {
      NotificationManager.error("Error", res.err || "", 5000);
    }
  }

  // Group pending candidates by GT network slug.
  const byChain: Record<string, Candidate[]> = {};
  for (const c of candidates) {
    (byChain[c.chain] ??= []).push(c);
  }
  const chains = Object.keys(byChain).sort();

  const promoteReady = (f: FormState): boolean =>
    !f.busy && !!f.template && !!f.chain.trim() && !!f.dex.trim() && !!f.factoryAddress.trim() && !!f.schemaFamily;

  return (
    <Layout crumb="Sources">
      <PageHeader
        title="DEX sources"
        sub="Review discovered (network, dex) candidates and promote the ones to support. Paste the DEX's subgraph URL to verify it, confirm the factory address and schema family, then promote — the literal API key is never stored (only the {API_KEY} template is). Run `yarn discover` to refresh candidates."
      />

      {/* Supported sources */}
      <div className="card card-pad" style={{ marginBottom: "var(--sp-6)" }}>
        <span className="eyebrow">Supported sources ({supported.length})</span>
        {supported.length === 0 ? (
          <p className="muted" style={{ marginTop: "var(--sp-3)" }}>
            No DB-backed sources yet — promote a candidate below to add the first.
          </p>
        ) : (
          <div className="src-tbl" style={{ marginTop: "var(--sp-3)" }}>
            <div className="src-head">
              <span>Chain</span>
              <span>DEX</span>
              <span>Provider</span>
              <span>Schema</span>
              <span>Factory</span>
              <span>Verified</span>
            </div>
            {supported.map((s) => (
              <div key={s.id} className="src-row">
                <span className="mono">{s.chain}</span>
                <span className="mono">{s.dex}</span>
                <span className="muted">{s.subgraphProvider}</span>
                <span><span className="badge badge-neutral badge-sm">{s.subgraphSchemaFamily}</span></span>
                <span className="mono truncate" title={s.factoryAddress}>{s.factoryAddress}</span>
                <span className="muted mono">{fmtDate(s.lastVerifiedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <span className="eyebrow" style={{ display: "block", marginBottom: "var(--sp-3)" }}>
        Candidates awaiting review ({candidates.length})
      </span>

      {candidates.length === 0 ? (
        <div className="card card-pad">
          <p className="muted">Nothing awaiting review 🎉 — run <span className="mono">yarn discover</span> to scan GeckoTerminal for new sources.</p>
        </div>
      ) : (
        chains.map((chain) => (
          <div key={chain} className="chain-block">
            <div className="chain-label mono">{chain} <span className="muted">({byChain[chain].length})</span></div>
            {byChain[chain].map((c) => (
              <div key={c.id} className="card cand">
                <div className="cand-head">
                  <span className="mono cand-dex">{c.dex}</span>
                  <span className="muted cand-meta">{c.source} · seen {fmtDate(c.firstSeen)}</span>
                  <span className="grow" />
                  {openId === c.id ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={close}>Close</button>
                  ) : (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => open(c)}>Review</button>
                  )}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => reject(c)}>Reject</button>
                </div>

                {openId === c.id && form ? (
                  <div className="cand-panel">
                    {/* Verify */}
                    <label className="fld-label" htmlFor={`url-${c.id}`}>
                      Subgraph URL
                      {form.seeded ? <span className="badge badge-info badge-sm" style={{ marginLeft: 8 }}>★ pre-filled from catalogue</span> : null}
                      {form.seedNote ? <span className="muted" style={{ marginLeft: 8 }}>{form.seedNote}</span> : null}
                    </label>
                    <div className="row gap-3">
                      <input
                        id={`url-${c.id}`}
                        className="input grow mono"
                        placeholder="https://gateway-arbitrum.network.thegraph.com/api/<key>/subgraphs/id/…"
                        value={form.url}
                        onChange={(e) => set({ url: e.target.value })}
                      />
                      <button type="button" className="btn btn-primary btn-sm" disabled={form.verifying} onClick={verify}>
                        {form.verifying ? "Verifying…" : "Verify"}
                      </button>
                    </div>

                    {form.live !== null ? (
                      <div className="verify-out">
                        <div className="vo-badges">
                          <span className={`badge badge-${form.live ? "pass" : "warn"} badge-sm`}>{form.live ? "live" : "not confirmed live"}</span>
                          {form.dataApplicable ? (
                            <span className={`badge badge-${form.dataOk ? "pass" : "warn"} badge-sm`} title={form.dataError || ""}>{form.dataOk ? "returning data" : "no usable data"}</span>
                          ) : form.live ? (
                            <span className="badge badge-neutral badge-sm">data probe n/a</span>
                          ) : null}
                          <span className="badge badge-neutral badge-sm">{form.provider}</span>
                          <span className="badge badge-neutral badge-sm">schema: {form.schemaFamily}</span>
                          {form.verifyError ? <span className="badge badge-fail badge-sm" title={form.verifyError}>probe error</span> : null}
                        </div>

                        <div className="vo-meta">
                          {form.keyEnvVar ? <div><span className="muted">API-key env var</span><span className="mono">{form.keyEnvVar}</span></div> : null}
                          {form.template ? <div className="vo-wide"><span className="muted">Template (API-key placeholder)</span><span className="mono vo-break">{form.template}</span></div> : null}
                        </div>

                        {form.dataApplicable && form.samples.length > 0 ? (
                          <div className="vo-section">
                            <span className="muted vo-h">Sample data — first {Math.min(5, form.rowCount)} of the {form.schemaFamily === "univ2" ? "pairs" : form.schemaFamily === "messari" ? "liquidityPools" : "pools"} go-ooo would query</span>
                            <div className="vo-tbl">
                              <div className="vo-tr vo-th"><span>id</span><span>token0Price</span><span>reserve / TVL</span></div>
                              {form.samples.slice(0, 5).map((s) => (
                                <div key={s.id} className="vo-tr">
                                  <span className="mono truncate" title={s.id}>{s.id}</span>
                                  <span className={`mono${s.price && s.price > 0 ? "" : " muted"}`}>{fmtPrice(s.price)}</span>
                                  <span className="mono">{s.reserve != null ? usd(s.reserve) : "—"}</span>
                                </div>
                              ))}
                            </div>
                            {!form.dataOk && form.dataError ? <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>{form.dataError}</span> : null}
                          </div>
                        ) : null}

                        {form.queryFields.length > 0 ? (
                          <div className="vo-section">
                            <span className="muted vo-h">Schema query fields ({form.queryFields.length})</span>
                            <div className="vo-fields">
                              {form.queryFields.map((f) => <span key={f} className="vo-chip mono">{f}</span>)}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {/* Confirm operational fields */}
                    <div className="fld-grid">
                      <div>
                        <label className="fld-label" htmlFor={`chain-${c.id}`}>Internal chain id</label>
                        <input id={`chain-${c.id}`} className="input mono" value={form.chain} onChange={(e) => set({ chain: e.target.value })} />
                      </div>
                      <div>
                        <label className="fld-label" htmlFor={`dex-${c.id}`}>Internal dex id</label>
                        <input id={`dex-${c.id}`} className="input mono" value={form.dex} onChange={(e) => set({ dex: e.target.value })} />
                      </div>
                      <div>
                        <label className="fld-label" htmlFor={`fam-${c.id}`}>Schema family</label>
                        <select id={`fam-${c.id}`} className="input" value={form.schemaFamily} onChange={(e) => set({ schemaFamily: e.target.value })}>
                          {SCHEMA_FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="fld-label" htmlFor={`api-${c.id}`}>API-key env var <span className="muted">(optional)</span></label>
                        <input id={`api-${c.id}`} className="input mono" placeholder={form.keyEnvVar || "(derive from provider)"} value={form.apiKeyEnvVar} onChange={(e) => set({ apiKeyEnvVar: e.target.value })} />
                      </div>
                      <div className="fld-wide">
                        <label className="fld-label" htmlFor={`fac-${c.id}`}>Factory address</label>
                        <input id={`fac-${c.id}`} className="input mono" placeholder="0x…" value={form.factoryAddress} onChange={(e) => set({ factoryAddress: e.target.value })} />
                      </div>
                    </div>

                    <div className="row gap-3 items-center" style={{ marginTop: "var(--sp-4)" }}>
                      <button type="button" className="btn btn-primary btn-sm" disabled={!promoteReady(form)} onClick={promote}>
                        {form.busy ? "Promoting…" : "Promote → Supported source"}
                      </button>
                      {!form.template ? <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>Verify a subgraph URL to enable promotion.</span> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))
      )}

      <style jsx>{`
        .src-tbl { display: flex; flex-direction: column; font-size: var(--fs-sm); }
        .src-head, .src-row { display: grid; grid-template-columns: 1fr 1.4fr 1.4fr 0.8fr 2fr 0.9fr; gap: var(--sp-3); align-items: center; padding: var(--sp-2) 0; }
        .src-head { color: var(--text-3); font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid var(--border); }
        .src-row { border-bottom: 1px solid var(--border); }
        .src-row:last-child { border-bottom: 0; }
        .chain-block { margin-bottom: var(--sp-5); }
        .chain-label { font-size: var(--fs-sm); font-weight: 600; margin-bottom: var(--sp-2); }
        .cand { padding: var(--sp-3) var(--sp-4); margin-bottom: var(--sp-2); }
        .cand-head { display: flex; align-items: center; gap: var(--sp-3); }
        .cand-dex { font-weight: 600; }
        .cand-meta { font-size: var(--fs-xs); }
        .cand-panel { margin-top: var(--sp-4); padding-top: var(--sp-4); border-top: 1px solid var(--border); }
        .fld-label { display: block; font-size: var(--fs-xs); color: var(--text-3); margin-bottom: var(--sp-1); }
        .verify-out { display: flex; flex-direction: column; gap: var(--sp-3); margin: var(--sp-3) 0; }
        .vo-badges { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); }
        .vo-meta { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-2) var(--sp-5); font-size: var(--fs-xs); }
        .vo-meta > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .vo-meta .vo-wide { grid-column: 1 / -1; }
        .vo-break { word-break: break-all; }
        .vo-section { display: flex; flex-direction: column; gap: var(--sp-2); }
        .vo-h { font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.04em; }
        .vo-tbl { display: flex; flex-direction: column; font-size: var(--fs-xs); border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
        .vo-tr { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--border); align-items: center; }
        .vo-tr:last-child { border-bottom: 0; }
        .vo-th { color: var(--text-3); background: var(--bg-3); }
        .vo-fields { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
        .vo-chip { font-size: var(--fs-xs); padding: 2px 8px; border-radius: var(--r-pill); border: 1px solid var(--border-strong); color: var(--text-1); }
        .fld-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); margin-top: var(--sp-4); }
        .fld-wide { grid-column: 1 / -1; }
        @media (max-width: 720px) { .fld-grid { grid-template-columns: 1fr; } }
      `}</style>
    </Layout>
  );
};

function SourcesPage(props: Props) {
  if (props.isOperator) {
    return <OperatorSources {...(props as OperatorProps)} />;
  }
  return <PublicSources {...(props as PublicProps)} />;
}

export default SourcesPage;
