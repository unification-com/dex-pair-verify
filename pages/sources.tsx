// pages/sources.tsx
// Phase 4, 4.A — the candidate review console. Lists Pending CandidateDexNetwork
// rows (from `yarn discover`), and for each lets the operator paste a subgraph
// URL → Verify (lib/subgraphVerify via /api/admin/verifysource) → confirm the
// operational fields → Promote into SupportedSource, or Reject (D4). GeckoTerminal
// gives only id+name per dex (Q1), so the subgraph URL + factory address are
// operator-supplied here. The literal API key is never persisted — Verify returns
// the {API_KEY} template, and only that template is promoted.
import { GetServerSideProps } from "next";
import React, { useState } from "react";
import { NotificationManager } from "react-notifications";

import Layout from "../components/shell/Layout";
import PageHeader from "../components/ui/PageHeader";
import prisma from "../lib/prisma";
import { decentralizedTemplate, seedForGt } from "../lib/sourceSeeds";
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

const SCHEMA_FAMILIES = ["univ2", "univ3", "custom"];

export const getServerSideProps: GetServerSideProps = async () => {
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

  return { props: { candidates, supported } };
};

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
  dataError: string | null;
  // Transient flags:
  verifying: boolean;
  busy: boolean;
};

const fmtDate = (s: number): string => (s > 0 ? new Date(s * 1000).toISOString().slice(0, 10) : "—");

const Sources: React.FC<{ candidates: Candidate[]; supported: Supported[] }> = (props) => {
  const [candidates, setCandidates] = useState<Candidate[]>(props.candidates);
  const [supported, setSupported] = useState<Supported[]>(props.supported);
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
                        <span className={`badge badge-${form.live ? "pass" : "warn"} badge-sm`}>
                          {form.live ? "live" : "not confirmed live"}
                        </span>
                        {form.dataApplicable ? (
                          <span className={`badge badge-${form.dataOk ? "pass" : "warn"} badge-sm`} title={form.dataError || ""}>
                            {form.dataOk ? `data ✓ ~$${Math.round(form.sampleReserveUsd ?? 0).toLocaleString("en-GB")}` : "no usable data"}
                          </span>
                        ) : form.live ? (
                          <span className="badge badge-neutral badge-sm">data n/a</span>
                        ) : null}
                        <span className="muted">provider: <span className="mono">{form.provider}</span></span>
                        {form.keyEnvVar ? <span className="muted">key: <span className="mono">{form.keyEnvVar}</span></span> : null}
                        {form.template ? <span className="muted">template: <span className="mono truncate" title={form.template}>{form.template}</span></span> : null}
                        {form.queryFields.length > 0 ? (
                          <span className="muted">fields: <span className="mono">{form.queryFields.slice(0, 8).join(", ")}{form.queryFields.length > 8 ? "…" : ""}</span></span>
                        ) : null}
                        {form.verifyError ? <span className="badge badge-fail badge-sm" title={form.verifyError}>probe error</span> : null}
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
        .verify-out { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-3); margin: var(--sp-3) 0; font-size: var(--fs-xs); }
        .verify-out .mono { max-width: 22rem; display: inline-block; vertical-align: bottom; }
        .fld-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); margin-top: var(--sp-4); }
        .fld-wide { grid-column: 1 / -1; }
        @media (max-width: 720px) { .fld-grid { grid-template-columns: 1fr; } }
      `}</style>
    </Layout>
  );
};

export default Sources;
