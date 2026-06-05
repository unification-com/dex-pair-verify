import { GetServerSideProps } from "next"
import Link from "next/link";
import { useRouter } from "next/router";
import React, { FormEvent, useEffect, useState } from "react"
import { NotificationManager } from 'react-notifications';

import ChainName from "../../components/ChainName";
import CoinGeckoCoinLink from "../../components/CoinGeckoCoinLink";
import CoinGeckoPoolLink from "../../components/CoinGeckoPoolLink";
import DexName from "../../components/DexName";
import ExplorerUrl from "../../components/ExplorerUrl";
import NativeToken from "../../components/NativeToken";
import PoolUrl from "../../components/PoolUrl";
import FenceChecklist from "../../components/review/FenceChecklist";
import QueueNav from "../../components/review/QueueNav";
import ReserveVsFloor from "../../components/review/ReserveVsFloor";
import TrustBadgeRow, { TrustSignals } from "../../components/review/TrustBadgeRow";
import Layout from "../../components/shell/Layout"
import ConfidenceMeter from "../../components/ui/ConfidenceMeter";
import DataTable, { Column } from "../../components/ui/DataTable";
import Icon from "../../components/ui/Icon";
import PageHeader from "../../components/ui/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import { deriveFences, UiFence } from "../../lib/fences";
import { operatorGate } from "../../lib/operatorGate";
import prisma from '../../lib/prisma';
import { isVerifiedStatus, VERIFIED_STATUSES } from "../../lib/status";
import { REASON_LABEL } from "../../lib/statusMeta";
import { evaluatePair } from "../../lib/verdict";
import { buildVerdictContext, PairWithTokens } from "../../lib/verdictRunner";
import { PairProps } from "../../types/props";
import { TokenPairStatus } from "../../types/types";

type VerdictView = { reasonCode: string; confidence: number | null; reason: string };
type QueueView = { ids: string[]; filterQs: string };
type MiniPair = { id: string; chain: string; dex: string; pair: string; reserveUsd: number; txCount: number; status: TokenPairStatus };

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const gate = await operatorGate(ctx);
  if (gate) return gate;
  const { params, query } = ctx;
  const id = String(params?.id);

  // Full rows drive the verdict engine; the SAME enrichment path the runner uses
  // (DRY) produces the per-token canonical/decimals/price/identity inputs the UI
  // fences need. Then deriveFences mirrors evaluatePair off those primitives.
  const full = await prisma.pair.findUnique({
    where: { id },
    include: { token0: true, token1: true },
  });
  if (full === null) {
    return { notFound: true }
  }
  const { context, input } = await buildVerdictContext(full as unknown as PairWithTokens);
  const result = evaluatePair(input, context);

  const fences = deriveFences({
    reserveUsd: input.reserveUsd,
    volumeUsd: input.volumeUsd,
    txCount: input.txCount,
    token0: { symbol: full.token0.symbol, ...input.token0 },
    token1: { symbol: full.token1.symbol, ...input.token1 },
    pairFactoryAddress: context.pairFactoryAddress,
    canonicalFactoryAddress: context.canonicalFactoryAddress,
    config: context.config,
  });

  // Trust signals, derived from the same primitives as the fences.
  const canonState = (a: string, canon: string | null): TrustSignals["canonical"] =>
    !canon ? "unknown" : canon.toLowerCase() === a.toLowerCase() ? "match" : "impostor";
  const c0 = canonState(input.token0.contractAddress, input.token0.canonicalAddress);
  const c1 = canonState(input.token1.contractAddress, input.token1.canonicalAddress);
  const canonical: TrustSignals["canonical"] =
    c0 === "impostor" || c1 === "impostor" ? "impostor" : c0 === "match" && c1 === "match" ? "match" : "unknown";
  const factory: TrustSignals["factory"] =
    context.pairFactoryAddress == null || context.canonicalFactoryAddress == null ? "unknown"
      : context.pairFactoryAddress.toLowerCase() === context.canonicalFactoryAddress.toLowerCase() ? "canonical" : "mismatch";
  const id0 = !!(input.token0.coingeckoCoinId || input.token0.identityConfirmed);
  const id1 = !!(input.token1.coingeckoCoinId || input.token1.identityConfirmed);

  // Sibling badge: distinct (chain, dex) where the SAME pair is verified elsewhere
  // — matched by canonical key (rigorous, cgId-based) OR the same symbol pair (what
  // the operator sees in "Similar pairs"; cross-chain bridged variants have
  // different cgIds so they only match by symbol). Union, deduped, excluding this
  // pair, verified-only — so a rejected clone (e.g. a thin xDai listing) doesn't count.
  const sibs = await prisma.pair.findMany({
    where: {
      id: { not: full.id },
      status: { in: [...VERIFIED_STATUSES] },
      OR: [
        { pair: { in: [`${full.token0.symbol}-${full.token1.symbol}`, `${full.token1.symbol}-${full.token0.symbol}`] } },
        ...(context.canonicalKey ? [{ canonicalKey: context.canonicalKey }] : []),
      ],
    },
    select: { chain: true, dex: true },
  });
  const verifiedSiblings = new Set(sibs.map((s) => `${s.chain}:${s.dex}`)).size;

  const signals: TrustSignals = {
    identityConfirmed: id0 && id1,
    canonical,
    factory,
    scamFlagged: context.tokenScamFlagged,
    scamReason: full.token0.isScamFlagged ? full.token0.scamReason : full.token1.isScamFlagged ? full.token1.scamReason : null,
    verifiedOnOtherDexs: verifiedSiblings,
  };

  // Display row (shaped + serialisable, as before) + the secondary tables.
  const pair = await prisma.pair.findUnique({
    where: { id },
    include: {
      token0: { select: { symbol: true, id: true, contractAddress: true, txCount: true, status: true, coingeckoCoinId: true } },
      token1: { select: { symbol: true, id: true, contractAddress: true, txCount: true, status: true, coingeckoCoinId: true } },
      duplicatePairs: { select: { duplicatePair: true } },
    },
  });

  const similarPairs = await prisma.pair.findMany({
    where: {
      OR: [
        { pair: `${full.token0.symbol}-${full.token1.symbol}` },
        { pair: `${full.token1.symbol}-${full.token0.symbol}` },
      ],
      NOT: { chain: full.chain, dex: full.dex },
    },
    include: {
      token0: { select: { symbol: true, id: true, contractAddress: true, txCount: true, status: true } },
      token1: { select: { symbol: true, id: true, contractAddress: true, txCount: true, status: true } },
    },
  });

  // Optional queue context: if the operator arrived from a filtered queue, fetch
  // the ordered id list so prev/next/"X of Y" work (same order as the queue).
  let queue: QueueView | null = null;
  const status = typeof query.status === "string" ? query.status : null;
  if (status) {
    const where: Record<string, string> = { status };
    if (typeof query.chain === "string") where.chain = query.chain;
    if (typeof query.dex === "string") where.dex = query.dex;
    if (typeof query.tier === "string") where.reviewTier = query.tier;
    const ordered = await prisma.pair.findMany({ where, orderBy: { reserveNativeCurrency: "desc" }, select: { id: true } });
    const qs = new URLSearchParams(where as Record<string, string>);
    queue = { ids: ordered.map((o) => o.id), filterQs: qs.toString() };
  }

  return {
    props: {
      pair,
      similarPairs,
      fences,
      signals,
      verdict: { reasonCode: result.reasonCode, confidence: result.confidence, reason: result.reason },
      floor: context.config.minLiquidityUsd,
      hardFloor: context.config.hardMinLiquidityUsd,
      autoVerifyBar: context.config.autoVerifyConfidence,
      queue,
    },
  }
}

type Props = {
  pair: PairProps;
  similarPairs: PairProps[];
  fences: UiFence[];
  signals: TrustSignals;
  verdict: VerdictView;
  floor: number;
  hardFloor: number;
  autoVerifyBar: number;
  queue: QueueView | null;
}

const usd = (n: number | null | undefined) => {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return "$" + (n / 1e3).toFixed(1) + "k";
  return "$" + n.toFixed(2);
};
const num = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(n);

const KV: React.FC<{ k: React.ReactNode; v: React.ReactNode }> = ({ k, v }) => (
  <div className="kv-row"><span className="kv-k muted">{k}</span><span className="kv-v mono">{v}</span></div>
);

const Pair: React.FC<Props> = (props) => {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] = useState(props.pair.status)

  useEffect(() => { setCurrentStatus(props.pair.status) }, [props.pair.status])

  const bothTokensVerified =
    isVerifiedStatus(props.pair.token0.status) && isVerifiedStatus(props.pair.token1.status);

  // Queue navigation: index of this pair in the ordered filtered list + movers.
  const q = props.queue;
  const qIndex = q ? q.ids.indexOf(props.pair.id) : -1;
  const goTo = (i: number) => {
    if (!q || i < 0 || i >= q.ids.length) return;
    router.push(`/p/${q.ids[i]}?${q.filterQs}`);
  };

  async function setStatus(status: TokenPairStatus, comment: string): Promise<boolean> {
    const body = new FormData();
    body.set("status", status);
    body.set("comment", comment);
    body.set("pairid", props.pair.id);
    const response = await fetch('/api/admin/setpairstatus', { method: 'POST', body })
    const res = await response.json()
    if (res.success) {
      NotificationManager.success("Success!", `Status changed to ${res.data.new_status}`, 4000);
      setCurrentStatus(res.data.new_status)
      return true;
    }
    NotificationManager.error("Error", `${res.err}`, 5000)
    return false;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    await setStatus(String(formData.get("status")) as TokenPairStatus, String(formData.get("comment") || ""))
  }

  async function verifyAndNext() {
    if (!bothTokensVerified) {
      NotificationManager.info("Verify tokens first", "Both tokens must be verified before the pair can be.", 5000);
      return;
    }
    const ok = await setStatus(TokenPairStatus.ManualVerified, "verified from review queue");
    if (ok && qIndex >= 0 && qIndex < (q?.ids.length ?? 0) - 1) goTo(qIndex + 1);
  }

  async function onRescan() {
    const response = await fetch('/api/admin/rescanpair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairid: props.pair.id }),
    })
    const res = await response.json()
    if (res.success) {
      if (res.data.skipped) {
        NotificationManager.info("Skipped", res.data.message, 5000)
      } else {
        const pct = Math.round(res.data.confidence * 100)
        NotificationManager.success("Verdict", `${res.data.new_status} (confidence ${pct}%) — ${res.data.reason}`, 8000);
        setCurrentStatus(res.data.new_status)
      }
    } else {
      NotificationManager.error("Error", `${res.err}`, 5000)
    }
  }

  // Keyboard-first review: ← prev · → next · V verify&next (skip when typing).
  useEffect(() => {
    if (!q) return;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      if (e.key === "ArrowLeft") goTo(qIndex - 1);
      else if (e.key === "ArrowRight") goTo(qIndex + 1);
      else if (e.key.toLowerCase() === "v") verifyAndNext();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, qIndex, bothTokensVerified]);

  const reasonLabel = REASON_LABEL[props.verdict.reasonCode] || props.verdict.reason || props.verdict.reasonCode;

  // Confidence maths: it's the share of SCORED (non-skipped) fence weight that
  // passed. Surfaced so the operator can see how the number was reached.
  const scored = props.fences.filter((f) => f.ok !== null).sort((a, b) => b.weight - a.weight);
  const totalW = scored.reduce((s, f) => s + f.weight, 0);
  const passedW = scored.filter((f) => f.ok).reduce((s, f) => s + f.weight, 0);
  const skippedN = props.fences.length - scored.length;

  const miniCols: Column<MiniPair>[] = [
    { key: "chain", label: "Chain", render: (r) => <ChainName chain={r.chain} /> },
    { key: "dex", label: "DEX", render: (r) => <DexName dex={r.dex} /> },
    { key: "pair", label: "Pair", sortable: true },
    { key: "reserveUsd", label: "Reserve", num: true, sortable: true, render: (r) => usd(r.reserveUsd) },
    { key: "txCount", label: "Tx", num: true, sortable: true, render: (r) => num(r.txCount) },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} size="sm" /> },
  ];
  const toMini = (p: PairProps | { id: string; chain: string; dex: string; pair: string; reserveUsd: number; txCount: number; status: TokenPairStatus }): MiniPair =>
    ({ id: p.id, chain: p.chain, dex: p.dex, pair: p.pair, reserveUsd: p.reserveUsd, txCount: p.txCount, status: p.status });

  const duplicates: MiniPair[] = (props.pair.duplicatePairs || []).map((d) => toMini(d.duplicatePair));
  const similar: MiniPair[] = props.similarPairs.map(toMini);

  const verifyOptDisabled = !bothTokensVerified;

  return (
    <Layout crumb={<Link href={q ? `/pairs?${q.filterQs}` : "/pairs"}><a>‹ Review queue</a></Link>}>
      <PageHeader
        title={props.pair.pair}
        badge={<StatusBadge status={currentStatus} method={props.pair.verificationMethod} />}
        sub={<span className="row gap-3 wrap items-center">
          <ChainName chain={props.pair.chain} /> · <DexName dex={props.pair.dex} /> ·{" "}
          <CoinGeckoPoolLink chain={props.pair.chain} contractAddress={props.pair.contractAddress} /> ·{" "}
          <PoolUrl chain={props.pair.chain} dex={props.pair.dex} contractAddress={props.pair.contractAddress} /> ·{" "}
          <ExplorerUrl chain={props.pair.chain} contractAddress={props.pair.contractAddress} linkType={"address"} />
        </span>}
        actions={isVerifiedStatus(props.pair.status)
          ? <Link href={`/price-test/pair/${props.pair.id}`}><a className="btn btn-ghost btn-sm" target="_blank"><Icon name="price" size={14} />Price test</a></Link>
          : null}
      />

      <div className="pair-grid">
        <div className="pair-main">
          <TrustBadgeRow signals={props.signals} />
          <div className="card card-pad"><FenceChecklist fences={props.fences} /></div>

          <div className="token-cards">
            {[props.pair.token0, props.pair.token1].map((t, i) => (
              <div className="card card-pad token-card" key={`tok_${i}`}>
                <div className="row spread items-center">
                  <span className="eyebrow">Token {i}</span>
                  <StatusBadge status={t.status} size="sm" />
                </div>
                <div className="tok-sym">{t.symbol}</div>
                <KV k="Address" v={<ExplorerUrl chain={props.pair.chain} contractAddress={t.contractAddress} linkType={"token"} />} />
                <KV k="CoinGecko" v={<CoinGeckoCoinLink coingeckoId={t.coingeckoCoinId} />} />
                <KV k="Tx count" v={num(t.txCount)} />
                <Link href={`/t/${t.id}`}><a className="btn btn-ghost btn-sm" style={{ marginTop: "var(--sp-4)" }}>View token →</a></Link>
              </div>
            ))}
          </div>

          <details className="card raw">
            <summary>CoinGecko market data</summary>
            <div className="kv-grid">
              <KV k="Market cap" v={usd(props.pair.marketCapUsd)} />
              <KV k={`${props.pair.token0.symbol} price`} v={`${num(Number(props.pair.token0PriceCg))} ${props.pair.token1.symbol}`} />
              <KV k={`${props.pair.token1.symbol} price`} v={`${num(Number(props.pair.token1PriceCg))} ${props.pair.token0.symbol}`} />
              <KV k="24h change" v={`${num(props.pair.priceChangePercentage24h)}%`} />
              <KV k="24h volume" v={usd(props.pair.volumeUsd24h)} />
            </div>
          </details>

          <details className="card raw">
            <summary>DEX subgraph reserves</summary>
            <div className="kv-grid">
              <KV k="Reserve USD" v={usd(props.pair.reserveUsd)} />
              <KV k="Reserve native" v={<>{num(props.pair.reserveNativeCurrency)} <NativeToken chain={props.pair.chain} /></>} />
              <KV k={`Reserve ${props.pair.token0.symbol}`} v={num(props.pair.reserve0)} />
              <KV k={`Reserve ${props.pair.token1.symbol}`} v={num(props.pair.reserve1)} />
              <KV k="Volume USD" v={usd(props.pair.volumeUsd)} />
              <KV k="Tx count" v={num(props.pair.txCount)} />
            </div>
          </details>

          <details className="card raw">
            <summary>24h activity</summary>
            <div className="kv-grid">
              <KV k="Buys" v={num(props.pair.buys24h)} />
              <KV k="Buyers" v={num(props.pair.buyers24h)} />
              <KV k="Sells" v={num(props.pair.sells24h)} />
              <KV k="Sellers" v={num(props.pair.sellers24h)} />
            </div>
          </details>

          {duplicates.length > 0 && (
            <details className="card raw">
              <summary>Possible duplicates on {props.pair.dex} ({duplicates.length})</summary>
              <DataTable columns={miniCols} data={duplicates} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/p/${r.id}`)} />
            </details>
          )}
          {similar.length > 0 && (
            <details className="card raw">
              <summary>Similar pairs on other DEXs ({similar.length})</summary>
              <DataTable columns={miniCols} data={similar} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/p/${r.id}`)} sortInit={{ key: "reserveUsd", dir: "desc" }} />
            </details>
          )}
        </div>

        <aside className="pair-rail">
          <div className="card card-pad rail-card">
            <span className="eyebrow">Verdict</span>
            <div className="reason-chip mono">{props.verdict.reasonCode}</div>
            <p className="reason-label">{reasonLabel}</p>
            <ConfidenceMeter value={props.verdict.confidence} threshold={props.autoVerifyBar} />
            <details className="conf-breakdown">
              <summary>How is this computed?</summary>
              <div className="cb-formula mono">{passedW} / {totalW} scored weight{props.verdict.confidence != null ? ` = ${Math.round(props.verdict.confidence * 100)}%` : ""}</div>
              <p className="cb-note muted">
                Each fence carries a weight; confidence is the share of <em>scored</em> weight that passed.
                {skippedN > 0 ? ` ${skippedN} skipped (unknown input).` : ""} An operator “Verify” sets it to 100%.{" "}
                <Link href="/help"><a>Scoring guide →</a></Link>
              </p>
              <div className="cb-list">
                {scored.map((f) => (
                  <div key={f.key} className="cb-item">
                    <span className={`cb-glyph ${f.ok ? "ok" : "no"}`}>{f.ok ? "✓" : "✕"}</span>
                    <span className="cb-label">{f.label}</span>
                    <span className="mono muted cb-w">{f.ok ? f.weight : 0}/{f.weight}</span>
                  </div>
                ))}
              </div>
            </details>
          </div>

          {q && qIndex >= 0 && (
            <div className="card card-pad rail-card">
              <QueueNav
                index={qIndex}
                total={q.ids.length}
                onPrev={() => goTo(qIndex - 1)}
                onNext={() => goTo(qIndex + 1)}
                onVerifyNext={verifyAndNext}
                label="in this queue"
              />
            </div>
          )}

          <div className="card card-pad rail-card">
            <span className="eyebrow">Decision</span>
            {verifyOptDisabled && (
              <p className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                Both tokens must be verified before this pair can be marked verified.
              </p>
            )}
            <form onSubmit={onSubmit} className="decision-form">
              <select name="status" defaultValue={currentStatus} className="input">
                <option value={TokenPairStatus.Unverified}>Unverified</option>
                <option value={TokenPairStatus.ManualVerified} disabled={verifyOptDisabled}>Verified</option>
                <option value={TokenPairStatus.Duplicate}>Duplicate</option>
                <option value={TokenPairStatus.NotCurrentlyUsable}>Not usable</option>
              </select>
              <input type="text" name="comment" defaultValue={props.pair.verificationComment} placeholder="optional comment" className="input" />
              <button type="submit" className="btn btn-primary"><Icon name="check" size={14} />Submit</button>
            </form>
            <button onClick={onRescan} type="button" className="btn btn-ghost btn-sm" style={{ marginTop: "var(--sp-3)" }}>
              <Icon name="refresh" size={14} />Re-run verdict
            </button>
          </div>

          <div className="card card-pad rail-card">
            <ReserveVsFloor reserveUsd={props.pair.reserveUsd} floor={props.floor} hardFloor={props.hardFloor} />
          </div>
        </aside>
      </div>

      <style jsx>{`
        .pair-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: var(--sp-6); align-items: start; }
        .pair-main { display: flex; flex-direction: column; gap: var(--sp-5); min-width: 0; }
        .pair-rail { display: flex; flex-direction: column; gap: var(--sp-5); position: sticky; top: var(--sp-6); }
        .rail-card { display: flex; flex-direction: column; gap: var(--sp-3); }
        .token-cards { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-5); }
        .token-card { display: flex; flex-direction: column; gap: var(--sp-2); }
        .tok-sym { font-size: var(--fs-xl); font-weight: 700; margin: var(--sp-1) 0 var(--sp-3); }
        .kv-row { display: flex; justify-content: space-between; gap: var(--sp-4); padding: var(--sp-2) 0; border-bottom: 1px solid var(--border); font-size: var(--fs-sm); }
        .kv-row:last-child { border-bottom: 0; }
        .kv-k { white-space: nowrap; }
        .kv-v { text-align: right; word-break: break-word; }
        .kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 var(--sp-7); padding-top: var(--sp-3); }
        .raw { padding: var(--sp-4) var(--sp-5); }
        .raw > summary { cursor: pointer; font-weight: 600; font-size: var(--fs-sm); color: var(--text-1); }
        .reason-chip { align-self: flex-start; font-size: var(--fs-xs); padding: 2px 8px; border: 1px solid var(--border-strong); border-radius: var(--r-pill); color: var(--text-1); }
        .reason-label { margin: 0; font-size: var(--fs-md); color: var(--text-0); }
        .conf-breakdown > summary { cursor: pointer; font-size: var(--fs-xs); color: var(--text-2); }
        .cb-formula { margin-top: var(--sp-3); font-weight: 600; }
        .cb-note { font-size: var(--fs-xs); margin: var(--sp-2) 0 var(--sp-3); }
        .cb-list { display: flex; flex-direction: column; gap: 1px; }
        .cb-item { display: flex; align-items: center; gap: var(--sp-3); font-size: var(--fs-xs); padding: 2px 0; }
        .cb-glyph { width: 14px; text-align: center; font-weight: 700; }
        .cb-glyph.ok { color: var(--pass); }
        .cb-glyph.no { color: var(--fail); }
        .cb-label { flex: 1; color: var(--text-1); }
        .cb-w { font-size: 10px; }
        .decision-form { display: flex; flex-direction: column; gap: var(--sp-3); }
        @media (max-width: 1024px) {
          .pair-grid { grid-template-columns: 1fr; }
          .pair-rail { position: static; }
        }
      `}</style>
    </Layout>
  )
}

export default Pair
