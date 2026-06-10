// pages/add.tsx
// Operator-only: manually add a pair (network, DEX, pool address) or a token
// (network, token address) and run it through the same verification pipeline as
// auto-ingested pairs. Follows the ingest pass-runner idiom: the client drives a
// loop of bounded /api/admin/* calls, paced, with a live progress log — no
// background job. Flow:
//   add pair   → ingest the pool → enrich+verdict it → (spider) for each token,
//                find it on other supported chains and ingest+verify its pools.
//   add token  → ingest the token's pools on the chain → enrich+verdict each →
//                (spider) the token across other chains.
// "become part of the pipeline as any other pair": nothing is force-verified — the
// verdict engine decides each pair's status, and the normal pipeline maintains it.
import { GetServerSideProps } from "next";
import React, { useState } from "react";
import { NotificationManager } from "react-notifications";

import ChainName from "../components/ChainName";
import DexName from "../components/DexName";
import Layout from "../components/shell/Layout";
import PageHeader from "../components/ui/PageHeader";
import StatusBadge from "../components/ui/StatusBadge";
import { operatorGate } from "../lib/operatorGate";
import { getSources } from "../lib/sourceConfig";
import { TokenPairStatus } from "../types/types";

import type { PairSummary, TokenSummary } from "../lib/manualAdd";

type Props = { chainDex: Record<string, string[]> };

// Ubiquitous quote/base assets: when adding a PAIR we don't spider these across
// chains (it would pull in hundreds of unrelated pools). Add the specific token via
// token-mode if you really want its other-chain pools. Compared case-insensitively.
const COMMON_QUOTE = new Set(
  ["weth", "eth", "wbnb", "bnb", "usdc", "usdc.e", "usdt", "dai", "wbtc", "busd", "wmatic", "matic", "wxdai", "xdai", "frax"].map((s) => s),
);

const PACE_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type ApiResult = { success: boolean; data?: unknown; err?: string };

async function post(path: string, body: Record<string, unknown>): Promise<ApiResult> {
  try {
    const r = await fetch(`/api/admin/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await r.json()) as ApiResult;
  } catch (e) {
    return { success: false, err: String(e) };
  }
}

type Mode = "pair" | "token";

const AddPage: React.FC<Props> = ({ chainDex }) => {
  const networks = Object.keys(chainDex).sort();
  const [mode, setMode] = useState<Mode>("pair");
  const [chain, setChain] = useState(networks[0] ?? "");
  const [dex, setDex] = useState(chainDex[networks[0] ?? ""]?.[0] ?? "");
  const [address, setAddress] = useState("");
  const [spiderOn, setSpiderOn] = useState(true);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [results, setResults] = useState<PairSummary[]>([]);

  const dexes = chainDex[chain] ?? [];
  const addLog = (m: string) => setLog((l) => [...l, m]);

  const onChainChange = (c: string) => {
    setChain(c);
    setDex(chainDex[c]?.[0] ?? "");
  };

  async function run() {
    setRunning(true);
    setLog([]);
    setResults([]);

    const seen = new Set<string>();
    const collected: PairSummary[] = [];

    // Run the verification passes on one pair (deduped) and collect the result.
    const enrich = async (pairId: string) => {
      if (seen.has(pairId)) return;
      seen.add(pairId);
      const r = await post("enrichpair", { pairid: pairId });
      if (r.success && r.data) {
        const s = r.data as PairSummary;
        collected.push(s);
        setResults([...collected]);
        addLog(`✓ ${s.pair} · ${s.chain}/${s.dex} → ${s.status}`);
      } else {
        addLog(`✗ verify ${pairId}: ${r.err ?? "failed"}`);
      }
      await sleep(PACE_MS);
    };

    // One hop: find this token on other supported chains, ingest + verify its pools.
    const spider = async (tChain: string, tAddress: string, label: string) => {
      addLog(`↪ spidering ${label} across chains…`);
      const d = await post("discoverchains", { chain: tChain, address: tAddress });
      if (!d.success) {
        addLog(`✗ discover ${label}: ${d.err ?? "failed"}`);
        return;
      }
      const data = (d.data ?? {}) as { cgId?: string; siblings?: { chain: string; address: string }[] };
      if (!data.cgId) {
        addLog(`· ${label}: no CoinGecko id — can't find it on other chains`);
        return;
      }
      const siblings = data.siblings ?? [];
      if (siblings.length === 0) {
        addLog(`· ${label}: no other-chain instances`);
        return;
      }
      for (const sib of siblings) {
        addLog(`+ ${label} on ${sib.chain} — ingesting pools…`);
        const a = await post("addtoken", { chain: sib.chain, address: sib.address });
        if (!a.success) {
          addLog(`✗ ${sib.chain}: ${a.err ?? "failed"}`);
          continue;
        }
        const pairIds = ((a.data as { pairIds?: string[] })?.pairIds) ?? [];
        addLog(`· ${sib.chain}: ${pairIds.length} pair(s) found`);
        for (const pid of pairIds) await enrich(pid);
        await sleep(PACE_MS);
      }
    };

    try {
      if (mode === "pair") {
        if (!chain || !dex || !address.trim()) {
          NotificationManager.warning("Pick a network, DEX and pool address", "", 3000);
          setRunning(false);
          return;
        }
        addLog(`adding pair ${address.trim()} on ${chain}/${dex}…`);
        const r = await post("addpair", { chain, dex, address: address.trim() });
        if (!r.success || !r.data) {
          NotificationManager.error("Could not add pair", r.err ?? "", 6000);
          addLog(`✗ ${r.err ?? "failed"}`);
          setRunning(false);
          return;
        }
        const primary = r.data as PairSummary;
        addLog(`ingested ${primary.pair} (${primary.tokens.map((t) => t.symbol).join("/")}) — verifying…`);
        await enrich(primary.pairId);
        if (spiderOn) {
          for (const t of primary.tokens) {
            if (COMMON_QUOTE.has(t.symbol.toLowerCase())) {
              addLog(`· skipped spidering ${t.symbol} (common quote asset — add it directly in Token mode if needed)`);
              continue;
            }
            await spider(t.chain, t.contractAddress, t.symbol || t.contractAddress);
          }
        }
      } else {
        if (!chain || !address.trim()) {
          NotificationManager.warning("Pick a network and token address", "", 3000);
          setRunning(false);
          return;
        }
        addLog(`adding token ${address.trim()} on ${chain} — finding pools…`);
        const r = await post("addtoken", { chain, address: address.trim() });
        if (!r.success) {
          NotificationManager.error("Could not add token", r.err ?? "", 6000);
          addLog(`✗ ${r.err ?? "failed"}`);
          setRunning(false);
          return;
        }
        const pairIds = ((r.data as { pairIds?: string[] })?.pairIds) ?? [];
        addLog(`found ${pairIds.length} pair(s) on ${chain} — verifying…`);
        for (const pid of pairIds) await enrich(pid);
        if (spiderOn) await spider(chain, address.trim(), address.trim());
      }

      NotificationManager.success("Done", `${collected.length} pair(s) processed`, 5000);
      addLog(`done — ${collected.length} pair(s) processed`);
    } catch (e) {
      NotificationManager.error("Error", String(e), 6000);
      addLog(`✗ ${String(e)}`);
    } finally {
      setRunning(false);
    }
  }

  const tokenChip = (t: TokenSummary) => (
    <span key={t.id} className="tok">
      <span className="mono">{t.symbol || "—"}</span>
      {t.coingeckoCoinId ? <span className="badge badge-neutral badge-sm">cg:{t.coingeckoCoinId}</span> : <span className="badge badge-warn badge-sm">no cgId</span>}
      {t.identityConfirmed ? <span className="badge badge-pass badge-sm">identity ✓</span> : null}
      {t.isScamFlagged ? <span className="badge badge-fail badge-sm">scam flag</span> : null}
    </span>
  );

  return (
    <Layout crumb="Add">
      <PageHeader
        title="Add a pair or token"
        sub="Manually add a pool by address, or a token by address, and run it through the full verification pipeline. The verdict engine decides each pair's status (nothing is force-verified). With spidering on, the added token(s) are also found on other supported chains and their pools verified. Data comes from GeckoTerminal — a pool it doesn't index can't be added."
      />

      <div className="card card-pad">
        {/* Mode toggle */}
        <div className="seg" role="tablist" aria-label="Add mode">
          <button type="button" className={`seg-btn${mode === "pair" ? " active" : ""}`} onClick={() => setMode("pair")} disabled={running}>Pair</button>
          <button type="button" className={`seg-btn${mode === "token" ? " active" : ""}`} onClick={() => setMode("token")} disabled={running}>Token</button>
        </div>

        <div className="fld-grid">
          <div>
            <label className="fld-label" htmlFor="net">Network</label>
            <select id="net" className="input" value={chain} onChange={(e) => onChainChange(e.target.value)} disabled={running}>
              {networks.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {mode === "pair" ? (
            <div>
              <label className="fld-label" htmlFor="dex">DEX</label>
              <select id="dex" className="input" value={dex} onChange={(e) => setDex(e.target.value)} disabled={running}>
                {dexes.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          ) : null}

          <div className="fld-wide">
            <label className="fld-label" htmlFor="addr">{mode === "pair" ? "Pool contract address" : "Token contract address"}</label>
            <input id="addr" className="input mono" placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value)} disabled={running} />
          </div>
        </div>

        <div className="row gap-3 items-center" style={{ marginTop: "var(--sp-4)" }}>
          <label className="chk">
            <input type="checkbox" checked={spiderOn} onChange={(e) => setSpiderOn(e.target.checked)} disabled={running} />
            <span>Spider across chains <span className="muted">(find the {mode === "pair" ? "tokens" : "token"} on other supported networks)</span></span>
          </label>
          <span className="grow" />
          <button type="button" className="btn btn-primary" onClick={run} disabled={running || !chain || !address.trim() || (mode === "pair" && !dex)}>
            {running ? "Working…" : mode === "pair" ? "Add + verify pair" : "Add + verify token"}
          </button>
        </div>
      </div>

      {/* Results */}
      {results.length > 0 ? (
        <div className="card card-pad" style={{ marginTop: "var(--sp-5)" }}>
          <span className="eyebrow">Verified pairs ({results.length})</span>
          <div className="res-list" style={{ marginTop: "var(--sp-3)" }}>
            {results.map((r) => (
              <div key={r.pairId} className="res">
                <div className="res-head">
                  <StatusBadge status={r.status as TokenPairStatus} size="sm" />
                  <span className="mono res-name">{r.pair}</span>
                  <span className="muted"><ChainName chain={r.chain} /> · <DexName dex={r.dex} /></span>
                  {r.confidence != null ? <span className="badge badge-neutral badge-sm">conf {(r.confidence * 100).toFixed(0)}%</span> : null}
                </div>
                <div className="res-toks">{r.tokens.map(tokenChip)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Progress log */}
      {log.length > 0 ? (
        <div className="card card-pad" style={{ marginTop: "var(--sp-5)" }}>
          <span className="eyebrow">Progress</span>
          <pre className="log">{log.join("\n")}</pre>
        </div>
      ) : null}

      <style jsx>{`
        .seg { display: inline-flex; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; margin-bottom: var(--sp-4); }
        .seg-btn { padding: var(--sp-2) var(--sp-4); background: var(--bg-2); border: 0; cursor: pointer; color: var(--text-2); font-size: var(--fs-sm); }
        .seg-btn.active { background: var(--accent); color: #fff; }
        .seg-btn:disabled { cursor: default; opacity: 0.7; }
        .fld-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); }
        .fld-wide { grid-column: 1 / -1; }
        .fld-label { display: block; font-size: var(--fs-xs); color: var(--text-3); margin-bottom: var(--sp-1); }
        .chk { display: inline-flex; align-items: center; gap: var(--sp-2); font-size: var(--fs-sm); cursor: pointer; }
        .res-list { display: flex; flex-direction: column; gap: var(--sp-2); }
        .res { border: 1px solid var(--border); border-radius: var(--r-md); padding: var(--sp-3); }
        .res-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-3); }
        .res-name { font-weight: 600; }
        .res-toks { display: flex; flex-wrap: wrap; gap: var(--sp-3); margin-top: var(--sp-2); }
        .tok { display: inline-flex; align-items: center; gap: var(--sp-2); }
        .log { font-size: var(--fs-xs); line-height: 1.6; white-space: pre-wrap; word-break: break-word; margin: var(--sp-3) 0 0; max-height: 360px; overflow: auto; }
        @media (max-width: 720px) { .fld-grid { grid-template-columns: 1fr; } }
      `}</style>
    </Layout>
  );
};

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const gate = await operatorGate(ctx);
  if (gate) return gate;

  const sources = await getSources();
  const chainDex: Record<string, string[]> = {};
  for (const s of sources) {
    if (s.onCoinGeckoTerminal === false) continue;
    (chainDex[s.chain] ??= []).push(s.dex);
  }
  for (const c of Object.keys(chainDex)) {
    chainDex[c] = Array.from(new Set(chainDex[c])).sort();
  }
  return { props: { chainDex } };
};

export default AddPage;
