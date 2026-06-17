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
import MiniPairTable, { MiniPair } from "../../components/MiniPairTable";
import PairMarketData from "../../components/PairMarketData";
import PoolUrl from "../../components/PoolUrl";
import FenceChecklist from "../../components/review/FenceChecklist";
import QueueNav from "../../components/review/QueueNav";
import ReserveVsFloor from "../../components/review/ReserveVsFloor";
import TrustBadgeRow, { TrustSignals } from "../../components/review/TrustBadgeRow";
import Layout from "../../components/shell/Layout"
import ConfidenceMeter from "../../components/ui/ConfidenceMeter";
import Icon from "../../components/ui/Icon";
import KV from "../../components/ui/KV";
import PageHeader from "../../components/ui/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import TokenStatusBadge from "../../components/ui/TokenStatusBadge";
import { deriveFences, UiFence } from "../../lib/fences";
import { num as fmtNum } from "../../lib/format";
import { isOperatorCtx } from "../../lib/operatorGate";
import prisma from '../../lib/prisma';
import { publicPairDetailSelect } from "../../lib/publicSelect";
import { isStatus, isVerifiedStatus, VERIFIED_STATUSES } from "../../lib/status";
import { REASON_LABEL, REASON_TONE } from "../../lib/statusMeta";
import { evaluatePair } from "../../lib/verdict";
import { buildVerdictContext, PairWithTokens } from "../../lib/verdictRunner";
import { PairProps } from "../../types/props";
import { TokenPairStatus } from "../../types/types";

// Detail pages show 2 dp; the shared formatter defaults to 0.
const num = (n: number | null | undefined) => fmtNum(n, 2);

type VerdictView = { reasonCode: string; confidence: number | null; reason: string };
type QueueView = { ids: string[]; filterQs: string };

// Trimmed pair shape for the public read-only view (no verdict/fence/trust internals).
type PublicTokenView = { symbol: string; id: string; contractAddress: string; txCount: number; status: TokenPairStatus; coingeckoCoinId: string | null };
type PublicPairView = {
  id: string; chain: string; dex: string; contractAddress: string; pair: string;
  status: TokenPairStatus; verificationMethod: string;
  reserveUsd: number; reserve0: number; reserve1: number; reserveNativeCurrency: number;
  volumeUsd: number; volumeUsd24h: number; marketCapUsd: number; txCount: number;
  token0PriceCg: number | string | null; token1PriceCg: number | string | null; priceChangePercentage24h: number;
  buys24h: number; sells24h: number; buyers24h: number; sellers24h: number;
  token0: PublicTokenView; token1: PublicTokenView;
};

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const operator = await isOperatorCtx(ctx);
  const { params, query } = ctx;
  const id = String(params?.id);

  // Public: read-only view of VERIFIED pairs only. Anything else is 404 to anon.
  if (!operator) {
    const pair = await prisma.pair.findFirst({
      where: { id, status: { in: [...VERIFIED_STATUSES] } },
      // Explicit public select — never an un-`select`-ed row, which would ship the
      // verdict drivers (confidence, verdictEvidence, reviewTier, …) into __NEXT_DATA__.
      select: publicPairDetailSelect,
    });
    if (pair === null) {
      return { notFound: true };
    }
    // The same pair traded elsewhere — verified-only, so anon can't click through
    // to an unverified clone (the public detail page 404s those anyway).
    const similar = await prisma.pair.findMany({
      where: {
        OR: [
          { pair: `${pair.token0.symbol}-${pair.token1.symbol}` },
          { pair: `${pair.token1.symbol}-${pair.token0.symbol}` },
        ],
        NOT: { chain: pair.chain, dex: pair.dex },
        status: { in: [...VERIFIED_STATUSES] },
      },
      select: { id: true, chain: true, dex: true, pair: true, reserveUsd: true, txCount: true, status: true },
      orderBy: { reserveNativeCurrency: "desc" },
    });
    return { props: { isOperator: false, pair, similar } };
  }

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
    firstParty: context.firstParty,
    reserveTrusted: context.reserveTrusted,
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
      token0: { select: { symbol: true, id: true, contractAddress: true, txCount: true, status: true, coingeckoCoinId: true, isScamFlagged: true, scamReason: true } },
      token1: { select: { symbol: true, id: true, contractAddress: true, txCount: true, status: true, coingeckoCoinId: true, isScamFlagged: true, scamReason: true } },
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
  // Whitelist the status against the enum — an arbitrary `?status=` string in a
  // `where` clause throws (status is a DB enum) → 500.
  const status = isStatus(query.status) ? query.status : null;
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
      isOperator: true,
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

type OperatorProps = {
  isOperator: true;
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
type PublicProps = {
  isOperator: false;
  pair: PublicPairView;
  similar: MiniPair[];
}
type Props = OperatorProps | PublicProps;

const toMini = (p: { id: string; chain: string; dex: string; pair: string; reserveUsd: number; txCount: number; status: TokenPairStatus }): MiniPair =>
  ({ id: p.id, chain: p.chain, dex: p.dex, pair: p.pair, reserveUsd: p.reserveUsd, txCount: p.txCount, status: p.status });

// Public read-only pair detail: status + symbols + the market-data boxes (shared
// with the operator view) + the same pair traded on other DEXs. No verdict /
// confidence / fences / trust internals, no actions.
const PublicPair: React.FC<PublicProps> = ({ pair, similar }) => (
  <Layout crumb={<Link href="/pairs"><a>‹ Verified pairs</a></Link>}>
    <PageHeader
      title={pair.pair}
      badge={<StatusBadge status={pair.status} method={pair.verificationMethod} />}
      sub={<span className="row gap-3 wrap items-center">
        <ChainName chain={pair.chain} /> · <DexName dex={pair.dex} /> ·{" "}
        <CoinGeckoPoolLink chain={pair.chain} contractAddress={pair.contractAddress} /> ·{" "}
        <PoolUrl chain={pair.chain} dex={pair.dex} contractAddress={pair.contractAddress} /> ·{" "}
        <ExplorerUrl chain={pair.chain} contractAddress={pair.contractAddress} linkType={"address"} />
      </span>}
    />

    <div className="pub-grid">
      <div className="token-cards">
        {[pair.token0, pair.token1].map((t, i) => (
          <div className="card card-pad token-card" key={`tok_${i}`}>
            <div className="row spread items-center">
              <span className="eyebrow">Token {i}</span>
              <StatusBadge status={t.status} size="sm" />
            </div>
            <div className="tok-sym">{t.symbol}</div>
            <KV k="Address" v={<ExplorerUrl chain={pair.chain} contractAddress={t.contractAddress} linkType={"token"} symbol={t.symbol} />} />
            <KV k="CoinGecko" v={<CoinGeckoCoinLink coingeckoId={t.coingeckoCoinId} />} />
            <KV k="Tx count" v={num(t.txCount)} />
            <Link href={`/t/${t.id}`}><a className="btn btn-ghost btn-sm" style={{ marginTop: "var(--sp-4)" }}>View token →</a></Link>
          </div>
        ))}
      </div>

      <PairMarketData pair={pair} />

      {similar.length > 0 && (
        <details className="card raw" open>
          <summary>Also traded on other DEXs ({similar.length})</summary>
          <MiniPairTable pairs={similar} sortInit={{ key: "reserveUsd", dir: "desc" }} />
        </details>
      )}
    </div>

    <style jsx>{`
      .pub-grid { display: flex; flex-direction: column; gap: var(--sp-5); }
      .token-cards { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-5); }
      .token-card { display: flex; flex-direction: column; gap: var(--sp-2); }
      .tok-sym { font-size: var(--fs-xl); font-weight: 700; margin: var(--sp-1) 0 var(--sp-3); }
      .raw { padding: var(--sp-4) var(--sp-5); }
      .raw > summary { cursor: pointer; font-weight: 600; font-size: var(--fs-sm); color: var(--text-1); }
      @media (max-width: 720px) { .token-cards { grid-template-columns: 1fr; } }
    `}</style>
  </Layout>
);

const OperatorPair: React.FC<OperatorProps> = (props) => {
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
  // Tone the Verdict chip: a negative reason (scam / impostor / reject) reads red, a needs-review one
  // amber, a positive one green; an unmapped code stays neutral.
  const reasonTone = REASON_TONE[props.verdict.reasonCode] || "neutral";

  // Confidence maths: it's the share of SCORED (non-skipped) fence weight that
  // passed. Surfaced so the operator can see how the number was reached.
  const scored = props.fences.filter((f) => f.ok !== null).sort((a, b) => b.weight - a.weight);
  const totalW = scored.reduce((s, f) => s + f.weight, 0);
  const passedW = scored.filter((f) => f.ok).reduce((s, f) => s + f.weight, 0);
  const skippedN = props.fences.length - scored.length;
  // The scored fences that FAILED — i.e. what's dragging the confidence below 100%.
  // Surfaced as a one-line "Held on:" so a clean-scanning pair's blocker is obvious
  // (a security scan is decision-support and never lifts these — they're the gates).
  const heldOn = props.fences.filter((f) => f.ok === false && f.weight > 0).sort((a, b) => b.weight - a.weight);

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
                  <TokenStatusBadge status={t.status} scamFlagged={t.isScamFlagged} scamReason={t.scamReason} size="sm" />
                </div>
                <div className="tok-sym">{t.symbol}</div>
                {t.isScamFlagged ? <p style={{ margin: "var(--sp-2) 0 0", color: "var(--fail)", fontSize: "0.85em" }} title={t.scamReason}>⚠ {t.scamReason || "flagged on a scam list"}</p> : null}
                <KV k="Address" v={<ExplorerUrl chain={props.pair.chain} contractAddress={t.contractAddress} linkType={"token"} symbol={t.symbol} />} />
                <KV k="CoinGecko" v={<CoinGeckoCoinLink coingeckoId={t.coingeckoCoinId} />} />
                <KV k="Tx count" v={num(t.txCount)} />
                <Link href={`/t/${t.id}`}><a className="btn btn-ghost btn-sm" style={{ marginTop: "var(--sp-4)" }}>View token →</a></Link>
              </div>
            ))}
          </div>

          <PairMarketData pair={props.pair} />

          {duplicates.length > 0 && (
            <details className="card raw" open>
              <summary>Possible duplicates on {props.pair.dex} ({duplicates.length})</summary>
              <MiniPairTable pairs={duplicates} />
            </details>
          )}
          {similar.length > 0 && (
            <details className="card raw" open>
              <summary>Similar pairs on other DEXs ({similar.length})</summary>
              <MiniPairTable pairs={similar} sortInit={{ key: "reserveUsd", dir: "desc" }} />
            </details>
          )}
        </div>

        <aside className="pair-rail">
          <div className="card card-pad rail-card">
            <span className="eyebrow">Verdict</span>
            <div className={`reason-chip mono tone-${reasonTone}`}>{props.verdict.reasonCode}</div>
            <p className="reason-label">{reasonLabel}</p>
            {heldOn.length > 0 && (
              <div className="held-on">
                <span className="held-label">Held on</span>
                <span className="held-fences">{heldOn.map((f) => f.label).join(" · ")}</span>
                {heldOn[0].note ? <span className="held-note muted">{heldOn[0].note}</span> : null}
              </div>
            )}
            <ConfidenceMeter value={props.verdict.confidence} threshold={props.autoVerifyBar} />
            <details className="conf-breakdown">
              <summary>How is this computed?</summary>
              {props.signals.scamFlagged
                ? <div className="cb-formula mono">scam-flagged → confidence floored to 0% (fences: {passedW}/{totalW})</div>
                : <div className="cb-formula mono">{passedW} / {totalW} scored weight{props.verdict.confidence != null ? ` = ${Math.round(props.verdict.confidence * 100)}%` : ""}</div>}
              <p className="cb-note muted">
                Each fence carries a weight; confidence is the share of <em>scored</em> weight that passed.
                {skippedN > 0 ? ` ${skippedN} skipped (unknown input).` : ""} A scam-list flag floors it to 0%. An operator “Verify” sets it to 100%.{" "}
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
        .raw { padding: var(--sp-4) var(--sp-5); }
        .raw > summary { cursor: pointer; font-weight: 600; font-size: var(--fs-sm); color: var(--text-1); }
        .reason-chip { align-self: flex-start; font-size: var(--fs-xs); padding: 2px 8px; border: 1px solid var(--border-strong); border-radius: var(--r-pill); color: var(--text-1); }
        .reason-chip.tone-fail { color: var(--fail); border-color: var(--fail-line); background: var(--fail-dim); }
        .reason-chip.tone-warn { color: var(--warn); border-color: var(--warn-line); background: var(--warn-dim); }
        .reason-chip.tone-pass { color: var(--pass); border-color: var(--pass-line); background: var(--pass-dim); }
        .reason-label { margin: 0; font-size: var(--fs-md); color: var(--text-0); }
        .held-on { display: flex; flex-direction: column; gap: 2px; padding: var(--sp-2) var(--sp-3); border-radius: var(--r-sm, 6px); border: 1px solid var(--warn-line, var(--warn)); background: var(--warn-dim, rgba(245,184,61,.1)); }
        .held-label { text-transform: uppercase; letter-spacing: .04em; font-weight: 600; font-size: 10px; color: var(--warn); }
        .held-fences { font-size: var(--fs-xs); color: var(--text-1); }
        .held-note { font-size: var(--fs-xs); }
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

function PairPage(props: Props) {
  if (props.isOperator) {
    return <OperatorPair {...(props as OperatorProps)} />
  }
  return <PublicPair {...(props as PublicProps)} />
}

export default PairPage
