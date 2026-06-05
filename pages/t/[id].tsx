import { GetServerSideProps } from "next"
import Link from "next/link";
import { useRouter } from "next/router";
import React, { FormEvent, useEffect, useState } from "react"
import { NotificationManager } from 'react-notifications';

import ChainName from "../../components/ChainName";
import CoinGeckoCoinLink from "../../components/CoinGeckoCoinLink";
import ExplorerUrl from "../../components/ExplorerUrl";
import Layout from "../../components/shell/Layout"
import ConfidenceMeter from "../../components/ui/ConfidenceMeter";
import DataTable, { Column } from "../../components/ui/DataTable";
import Icon from "../../components/ui/Icon";
import PageHeader from "../../components/ui/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import { usd, num as fmtNum, ageStr } from "../../lib/format";
import { isOperatorCtx } from "../../lib/operatorGate";
import prisma from '../../lib/prisma';
import { isVerifiedStatus, VERIFIED_STATUSES } from "../../lib/status";
import { getTokenWebPresence, TokenWebPresence } from "../../lib/tokenWebPresence";
import { AssociatedPairProps, TokenProps } from "../../types/props";
import { TokenPairStatus } from "../../types/types";

// Detail pages show 2 dp; the shared formatter defaults to 0.
const num = (n: number | null | undefined) => fmtNum(n, 2);

const pairSelect = {
    pair: true, id: true, contractAddress: true, reserveUsd: true, reserve0: true,
    reserve1: true, reserveNativeCurrency: true, volumeUsd: true, volumeUsd24h: true,
    txCount: true, confidence: true, status: true, dex: true,
};

// Trimmed token shape for the public read-only view (no trust/scam/web internals).
type PublicTokenDetail = {
    id: string; chain: string; contractAddress: string; symbol: string; name: string;
    status: TokenPairStatus; verificationMethod: string;
    coingeckoCoinId: string | null; decimals: number; deploymentTimestamp: number | null;
};

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const operator = await isOperatorCtx(ctx);
  const { params } = ctx;
  const id = String(params?.id);

  // Public: read-only view of VERIFIED tokens only. Anything else is 404 to anon.
  if (!operator) {
    const token = await prisma.token.findFirst({
      where: { id, status: { in: [...VERIFIED_STATUSES] } },
      include: { pairsToken0: { select: pairSelect }, pairsToken1: { select: pairSelect } },
    });
    if (token === null) {
      return { notFound: true };
    }
    const { pairsToken0, pairsToken1, ...scalar } = token;
    const pools = (pairsToken1 || []).concat(pairsToken0 || []).filter((p) => isVerifiedStatus(p.status as TokenPairStatus));
    return { props: { isOperator: false, token: scalar, pools } };
  }

    const token = await prisma.token.findUnique({
        where: { id },
        include: {
            pairsToken0: { select: pairSelect },
            pairsToken1: { select: pairSelect },
            duplicateTokenSymbols: { select: { duplicateToken: true } },
        },
    });
    if (token === null) {
        return { notFound: true }
    }
    const similarTokens = await prisma.token.findMany({
        where: { symbol: token.symbol, NOT: { chain: token.chain } },
    })
    // Free decision-support enrichment (GeckoTerminal web/socials + Blockscout
    // holders), write-through cached on the token row; degrades to blank on
    // failure, never blocks the page.
    const web = await getTokenWebPresence(token)
    return { props: { isOperator: true, token, similarTokens, web } }
}

type OperatorProps = {
    isOperator: true;
    token: TokenProps;
    similarTokens: TokenProps[];
    web: TokenWebPresence;
}
type PublicProps = {
    isOperator: false;
    token: PublicTokenDetail;
    pools: AssociatedPairProps[];
}
type Props = OperatorProps | PublicProps;

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

const KV: React.FC<{ k: React.ReactNode; v: React.ReactNode }> = ({ k, v }) => (
    <div className="kv-row"><span className="muted">{k}</span><span className="mono" style={{ textAlign: "right" }}>{v}</span></div>
);

type Tone = "pass" | "fail" | "warn" | "skip";
const TrustRow: React.FC<{ label: string; tone: Tone; value: string; detail?: string }> = ({ label, tone, value, detail }) => (
    <div className="trust-row">
        <span className="tr-label">{label}</span>
        <span className={`badge badge-${tone} badge-sm`}>{value}</span>
        {detail ? <span className="tr-detail muted">{detail}</span> : null}
    </div>
);

// The public associated-pairs table (no confidence column — that's internal).
const publicPairCols: Column<AssociatedPairProps>[] = [
    { key: "pair", label: "Pair", sortable: true, render: (p) => <span style={{ fontWeight: 600 }}>{p.pair}</span> },
    { key: "dex", label: "DEX", sortable: true },
    { key: "reserveUsd", label: "Liquidity", num: true, sortable: true, render: (p) => usd(p.reserveUsd) },
    { key: "txCount", label: "Tx", num: true, sortable: true, render: (p) => num(p.txCount) },
    { key: "status", label: "Status", render: (p) => <StatusBadge status={p.status} size="sm" /> },
];

// Public read-only token detail: identity + market facts + verified pools.
const PublicToken: React.FC<PublicProps> = ({ token: t, pools }) => {
    const router = useRouter()
    const totalLiquidity = pools.reduce((s, p) => s + (p.reserveUsd || 0), 0)
    const vol24h = pools.reduce((s, p) => s + (p.volumeUsd24h || 0), 0)

    return (
        <Layout crumb={<Link href="/tokens"><a>‹ Verified tokens</a></Link>}>
            <PageHeader
                title={t.symbol}
                badge={<StatusBadge status={t.status} method={t.verificationMethod} />}
                sub={<span className="row gap-3 wrap items-center">
                    {t.name} · <ChainName chain={t.chain} /> ·{" "}
                    <ExplorerUrl chain={t.chain} contractAddress={t.contractAddress} linkType={"token"} /> ·{" "}
                    <CoinGeckoCoinLink coingeckoId={t.coingeckoCoinId} />
                </span>}
            />

            <div className="tok-main">
                <div className="card card-pad">
                    <span className="eyebrow" style={{ display: "block", marginBottom: "var(--sp-1)" }}>Identity</span>
                    <div className="kv-grid">
                        <KV k="CoinGecko" v={t.coingeckoCoinId ? <CoinGeckoCoinLink coingeckoId={t.coingeckoCoinId} /> : "—"} />
                        <KV k="Decimals" v={String(t.decimals)} />
                        <KV k="Age" v={ageStr(t.deploymentTimestamp)} />
                        <KV k="Address" v={<ExplorerUrl chain={t.chain} contractAddress={t.contractAddress} linkType={"token"} />} />
                    </div>
                </div>

                <div className="card card-pad">
                    <span className="eyebrow" style={{ display: "block", marginBottom: "var(--sp-1)" }}>Across its verified pools</span>
                    <div className="kv-grid">
                        <KV k="Verified pools" v={pools.length} />
                        <KV k="Total liquidity" v={usd(totalLiquidity)} />
                        <KV k="24h volume" v={usd(vol24h)} />
                    </div>
                </div>

                <div className="card card-pad">
                    <span className="eyebrow" style={{ marginBottom: "var(--sp-3)", display: "block" }}>Verified pairs ({pools.length})</span>
                    <DataTable columns={publicPairCols} data={pools} rowKey={(p) => p.id} onRowClick={(p) => router.push(`/p/${p.id}`)} sortInit={{ key: "reserveUsd", dir: "desc" }} empty="No verified pairs." />
                </div>
            </div>

            <style jsx>{`
                .tok-main { display: flex; flex-direction: column; gap: var(--sp-5); }
                .kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 var(--sp-7); padding-top: var(--sp-3); }
                .kv-row { display: flex; justify-content: space-between; gap: var(--sp-4); padding: var(--sp-2) 0; border-bottom: 1px solid var(--border); font-size: var(--fs-sm); }
            `}</style>
        </Layout>
    )
}

const OperatorToken: React.FC<OperatorProps> = (props) => {
    const router = useRouter()
    const t = props.token;
    const [currentStatus, setCurrentStatus] = useState(t.status)
    useEffect(() => { setCurrentStatus(t.status) }, [t.status])

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const formData = new FormData(event.currentTarget)
        const response = await fetch('/api/admin/settokenstatus', { method: 'POST', body: formData })
        const res = await response.json()
        if (res.success) {
            NotificationManager.success("Success!", `Status changed to ${res.data.new_status}`, 5000);
            setCurrentStatus(res.data.new_status)
        } else {
            NotificationManager.error("Error", `${res.err}`, 5000)
        }
    }

    const duplicateTokens: TokenProps[] = (t.duplicateTokenSymbols || []).map((d) => d.duplicateToken)
    const pools: AssociatedPairProps[] = (t.pairsToken1 || []).concat(t.pairsToken0 || [])

    // Token-level market data isn't captured by ingest (it only writes pair-level
    // stats), so aggregate the token's pools instead — that data IS available.
    const totalLiquidity = pools.reduce((s, p) => s + (p.reserveUsd || 0), 0)
    const vol24h = pools.reduce((s, p) => s + (p.volumeUsd24h || 0), 0)
    const bestConf = pools.reduce((m, p) => Math.max(m, p.confidence ?? 0), 0)
    const verifiedPools = pools.filter((p) => isVerifiedStatus(p.status)).length

    // Identity & trust signals (the token-level scoring inputs).
    const cgId = t.coingeckoCoinId;
    const idTone: Tone = t.identityConfirmed ? "pass" : cgId ? "skip" : "warn";
    const idValue = t.identityConfirmed ? "confirmed (≥2 sources)" : cgId ? "not needed — CoinGecko-listed" : "unconfirmed";

    const tokenCols: Column<TokenProps>[] = [
        { key: "symbol", label: "Symbol", sortable: true, render: (tk) => <span style={{ fontWeight: 600 }}>{tk.symbol}</span> },
        { key: "name", label: "Name", sortable: true },
        { key: "coingeckoCoinId", label: "CG ID", render: (tk) => <CoinGeckoCoinLink coingeckoId={tk.coingeckoCoinId} /> },
        { key: "status", label: "Status", render: (tk) => <StatusBadge status={tk.status} size="sm" /> },
    ]
    const similarCols: Column<TokenProps>[] = [
        { key: "chain", label: "Chain", render: (tk) => <ChainName chain={tk.chain} /> },
        ...tokenCols,
    ]
    const pairCols: Column<AssociatedPairProps>[] = [
        { key: "pair", label: "Pair", sortable: true, render: (p) => <span style={{ fontWeight: 600 }}>{p.pair}</span> },
        { key: "dex", label: "DEX", sortable: true },
        { key: "reserveUsd", label: "Reserve", num: true, sortable: true, render: (p) => usd(p.reserveUsd) },
        { key: "txCount", label: "Tx", num: true, sortable: true, render: (p) => num(p.txCount) },
        { key: "confidence", label: "Conf", sortable: true, sortVal: (p) => p.confidence ?? -1, render: (p) => <ConfidenceMeter value={p.confidence} compact /> },
        { key: "status", label: "Status", render: (p) => <StatusBadge status={p.status} size="sm" /> },
    ]

    return (
        <Layout crumb="Token">
            <PageHeader
                title={t.symbol}
                badge={<StatusBadge status={currentStatus} method={t.verificationMethod} />}
                sub={<span className="row gap-3 wrap items-center">
                    {t.name} · <ChainName chain={t.chain} /> ·{" "}
                    <ExplorerUrl chain={t.chain} contractAddress={t.contractAddress} linkType={"token"} /> ·{" "}
                    <CoinGeckoCoinLink coingeckoId={t.coingeckoCoinId} />
                </span>}
            />

            <div className="tok-grid">
                <div className="tok-main">
                    {t.isScamFlagged && (
                        <div className="card card-pad scam-callout">
                            <span className="badge badge-fail"><span className="glyph">⚠</span>Scam-flagged</span>
                            <p style={{ margin: "var(--sp-3) 0 0", color: "var(--fail)" }}>{t.scamReason}</p>
                        </div>
                    )}

                    <div className="card card-pad">
                        <div className="row spread items-center" style={{ marginBottom: "var(--sp-3)" }}>
                            <span className="eyebrow">Identity &amp; trust</span>
                            <Link href="/help"><a className="muted" style={{ fontSize: "var(--fs-xs)" }}>What do these mean? →</a></Link>
                        </div>
                        <div className="trust-list">
                            <TrustRow label="CoinGecko" tone={cgId ? "pass" : "skip"} value={cgId ? "listed" : "not listed"} detail={cgId || undefined} />
                            <TrustRow label="Independent identity" tone={idTone} value={idValue} />
                            {t.identityData && t.identityData.map((s, i) => (
                                <div key={`id_${i}`} className="trust-sub">
                                    <span className={`badge badge-${s.confirmed ? "pass" : "skip"} badge-sm`}>{s.confirmed ? "✓" : "–"} {s.category}</span>
                                    <span className="muted">{s.detail}</span>
                                </div>
                            ))}
                            <TrustRow label="Canonical address" tone={t.canonicalCheckedAt > 0 ? "pass" : "skip"} value={t.canonicalCheckedAt > 0 ? "resolved" : "not checked"} />
                            <TrustRow label="Scam scan (GoPlus)" tone={t.isScamFlagged ? "fail" : t.scamCheckedAt > 0 ? "pass" : "skip"} value={t.isScamFlagged ? "flagged" : t.scamCheckedAt > 0 ? "clear" : "not run"} detail={t.isScamFlagged ? t.scamReason : undefined} />
                            <TrustRow label="Decimals" tone={t.decimals >= 0 && t.decimals <= 36 ? "pass" : "fail"} value={String(t.decimals)} />
                            <TrustRow label="Age" tone="skip" value={ageStr(t.deploymentTimestamp)} />
                        </div>
                    </div>

                    {(props.web.websites.length > 0 || props.web.twitter || props.web.telegram || props.web.discord || props.web.description || props.web.holders != null) && (
                        <div className="card card-pad">
                            <div className="row spread items-center" style={{ marginBottom: "var(--sp-3)" }}>
                                <span className="eyebrow">Web presence</span>
                                <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>decision support · not a trust gate</span>
                            </div>
                            <div className="row gap-4 items-start wrap">
                                {props.web.imageUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element -- remote token logo from GeckoTerminal
                                    <img src={props.web.imageUrl} alt="" width={40} height={40} style={{ borderRadius: 8, flex: "none" }} />
                                ) : null}
                                <div className="col gap-3" style={{ flex: 1, minWidth: 0 }}>
                                    {props.web.description ? <p className="muted" style={{ fontSize: "var(--fs-sm)", margin: 0 }}>{props.web.description}</p> : null}
                                    <div className="row gap-4 wrap" style={{ fontSize: "var(--fs-sm)" }}>
                                        {props.web.websites.map((w, i) => <a key={`web_${i}`} href={w} target="_blank" rel="noreferrer">{hostOf(w)}</a>)}
                                        {props.web.twitter ? <a href={props.web.twitter} target="_blank" rel="noreferrer">Twitter</a> : null}
                                        {props.web.telegram ? <a href={props.web.telegram} target="_blank" rel="noreferrer">Telegram</a> : null}
                                        {props.web.discord ? <a href={props.web.discord} target="_blank" rel="noreferrer">Discord</a> : null}
                                        {props.web.websites.length === 0 && !props.web.twitter && !props.web.telegram && !props.web.discord ? <span className="muted">no links on GeckoTerminal</span> : null}
                                    </div>
                                </div>
                            </div>
                            <div className="kv-grid" style={{ marginTop: "var(--sp-3)" }}>
                                <KV k="Holders (Blockscout)" v={props.web.holders != null ? num(props.web.holders) : "—"} />
                                <KV k="Transfers" v={props.web.transfers != null ? num(props.web.transfers) : "—"} />
                            </div>
                        </div>
                    )}

                    <div className="card card-pad">
                        <span className="eyebrow" style={{ display: "block", marginBottom: "var(--sp-1)" }}>Across its pools</span>
                        <div className="kv-grid">
                            <KV k="Pools" v={pools.length} />
                            <KV k="Verified pools" v={verifiedPools} />
                            <KV k="Total liquidity" v={usd(totalLiquidity)} />
                            <KV k="24h volume" v={usd(vol24h)} />
                            <KV k="Best pair confidence" v={bestConf > 0 ? Math.round(bestConf * 100) + "%" : "—"} />
                        </div>
                        <p className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: "var(--sp-3)" }}>
                            Token-level market cap / supply aren&apos;t captured by ingest — these aggregate the token&apos;s pools.
                        </p>
                    </div>

                    {t.scamCheckedAt > 0 && t.goPlusData && (
                        <details className="card raw">
                            <summary>GoPlus security signals</summary>
                            <div className="gp-grid">
                                {Object.entries(t.goPlusData)
                                    .filter(([, v]) => typeof v === "string" || typeof v === "number")
                                    .map(([k, v]) => (
                                        <div key={`gp_${k}`} className="gp-row">
                                            <span className="muted">{k}:</span> <span className="mono">{String(v)}</span>
                                        </div>
                                    ))}
                            </div>
                        </details>
                    )}

                    <div className="card card-pad">
                        <span className="eyebrow" style={{ marginBottom: "var(--sp-3)", display: "block" }}>Associated pairs ({pools.length})</span>
                        <DataTable columns={pairCols} data={pools} rowKey={(p) => p.id} onRowClick={(p) => router.push(`/p/${p.id}`)} sortInit={{ key: "reserveUsd", dir: "desc" }} empty="No pairs." />
                    </div>

                    {duplicateTokens.length > 0 && (
                        <details className="card raw">
                            <summary>Possible duplicates on {t.chain} ({duplicateTokens.length})</summary>
                            <DataTable columns={tokenCols} data={duplicateTokens} rowKey={(tk) => tk.id} onRowClick={(tk) => router.push(`/t/${tk.id}`)} />
                        </details>
                    )}
                    {props.similarTokens.length > 0 && (
                        <details className="card raw">
                            <summary>Similar tokens on other chains ({props.similarTokens.length})</summary>
                            <DataTable columns={similarCols} data={props.similarTokens} rowKey={(tk) => tk.id} onRowClick={(tk) => router.push(`/t/${tk.id}`)} />
                        </details>
                    )}
                </div>

                <aside className="tok-rail">
                    <div className="card card-pad col gap-3">
                        <span className="eyebrow">Decision</span>
                        <form onSubmit={onSubmit} className="col gap-3">
                            <select name="status" defaultValue={currentStatus} className="input">
                                <option value={TokenPairStatus.Unverified}>Unverified</option>
                                <option value={TokenPairStatus.ManualVerified}>Verified</option>
                                <option value={TokenPairStatus.Duplicate}>Duplicate</option>
                                <option value={TokenPairStatus.NotCurrentlyUsable}>Not usable</option>
                            </select>
                            <input type="text" name="comment" defaultValue={t.verificationComment} placeholder="optional comment" className="input" />
                            <input type="hidden" name="tokenid" value={t.id} />
                            <button type="submit" className="btn btn-primary"><Icon name="check" size={14} />Submit</button>
                        </form>
                        <p className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                            Marking a token Not usable / Duplicate cascades that status to all its associated pairs.
                        </p>
                    </div>
                </aside>
            </div>

            <style jsx>{`
                .tok-grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: var(--sp-6); align-items: start; }
                .tok-main { display: flex; flex-direction: column; gap: var(--sp-5); min-width: 0; }
                .tok-rail { position: sticky; top: var(--sp-6); }
                .scam-callout { border-color: var(--fail-line, var(--fail)); }
                .kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 var(--sp-7); padding-top: var(--sp-3); }
                .kv-row { display: flex; justify-content: space-between; gap: var(--sp-4); padding: var(--sp-2) 0; border-bottom: 1px solid var(--border); font-size: var(--fs-sm); }
                .trust-list { display: flex; flex-direction: column; gap: var(--sp-1); }
                .trust-row { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) 0; border-bottom: 1px solid var(--border); font-size: var(--fs-sm); }
                .tr-label { min-width: 150px; color: var(--text-1); }
                .tr-detail { font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .trust-sub { display: flex; align-items: center; gap: var(--sp-3); padding: 2px 0 2px var(--sp-6); font-size: var(--fs-xs); }
                .raw { padding: var(--sp-4) var(--sp-5); }
                .raw > summary { cursor: pointer; font-weight: 600; font-size: var(--fs-sm); color: var(--text-1); }
                .gp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px var(--sp-7); padding-top: var(--sp-3); }
                .gp-row { font-size: var(--fs-xs); padding: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                @media (max-width: 1024px) { .tok-grid { grid-template-columns: 1fr; } .tok-rail { position: static; } }
            `}</style>
        </Layout>
    )
}

function TokenPage(props: Props) {
    if (props.isOperator) {
        return <OperatorToken {...(props as OperatorProps)} />
    }
    return <PublicToken {...(props as PublicProps)} />
}

export default TokenPage;
