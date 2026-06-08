import { GetServerSideProps } from "next"
import Link from "next/link";
import { useRouter } from "next/router";
import React, { FormEvent, useEffect, useState } from "react"
import { NotificationManager } from 'react-notifications';

import ChainName from "../../components/ChainName";
import CoinGeckoCoinLink from "../../components/CoinGeckoCoinLink";
import ExplorerUrl from "../../components/ExplorerUrl";
import Layout from "../../components/shell/Layout"
import TokenOrganicityCard from "../../components/TokenOrganicity";
import TokenWebPresenceCard from "../../components/TokenWebPresence";
import ConfidenceMeter from "../../components/ui/ConfidenceMeter";
import DataTable, { Column } from "../../components/ui/DataTable";
import Icon from "../../components/ui/Icon";
import KV from "../../components/ui/KV";
import PageHeader from "../../components/ui/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import { usd, num as fmtNum, ageStr } from "../../lib/format";
import { isOperatorCtx } from "../../lib/operatorGate";
import { OrganicitySummary, summariseOrganicity } from "../../lib/organicity";
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
    buys24h: true, sells24h: true, buyers24h: true, sellers24h: true,
};

// Trimmed token shape for the public read-only view (no trust/scam internals).
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
    // Same free decision-support enrichment as the operator view (write-through
    // cached on the token row, so anon traffic doesn't re-fetch per request).
    const web = await getTokenWebPresence(token);
    const { pairsToken0, pairsToken1, ...scalar } = token;
    const pools = (pairsToken1 || []).concat(pairsToken0 || []).filter((p) => isVerifiedStatus(p.status as TokenPairStatus));
    const organicity = summariseOrganicity(pools);
    return { props: { isOperator: false, token: scalar, pools, web, organicity } };
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
    const organicity = summariseOrganicity((token.pairsToken0 || []).concat(token.pairsToken1 || []))
    return { props: { isOperator: true, token, similarTokens, web, organicity } }
}

type OperatorProps = {
    isOperator: true;
    token: TokenProps;
    similarTokens: TokenProps[];
    web: TokenWebPresence;
    organicity: OrganicitySummary;
}
type PublicProps = {
    isOperator: false;
    token: PublicTokenDetail;
    pools: AssociatedPairProps[];
    web: TokenWebPresence;
    organicity: OrganicitySummary;
}
type Props = OperatorProps | PublicProps;

type Tone = "pass" | "fail" | "warn" | "skip";
const TrustRow: React.FC<{ label: string; tone: Tone; value: string; detail?: string }> = ({ label, tone, value, detail }) => (
    <div className="trust-row">
        <span className="tr-label">{label}</span>
        <span className={`badge badge-${tone} badge-sm`}>{value}</span>
        {detail ? <span className="tr-detail muted">{detail}</span> : null}
    </div>
);

// Honeypot.is buy/sell tax suffix for the trust row.
const hpTax = (hp: { buyTax: number | null; sellTax: number | null }): string =>
    hp.buyTax != null || hp.sellTax != null ? ` · tax ${hp.buyTax ?? "?"}/${hp.sellTax ?? "?"}%` : "";

// The public associated-pairs table (no confidence column — that's internal).
const publicPairCols: Column<AssociatedPairProps>[] = [
    { key: "pair", label: "Pair", sortable: true, render: (p) => <span style={{ fontWeight: 600 }}>{p.pair}</span> },
    { key: "dex", label: "DEX", sortable: true },
    { key: "reserveUsd", label: "Liquidity", num: true, sortable: true, render: (p) => usd(p.reserveUsd) },
    { key: "txCount", label: "Tx", num: true, sortable: true, render: (p) => num(p.txCount) },
    { key: "status", label: "Status", render: (p) => <StatusBadge status={p.status} size="sm" /> },
];

// Public read-only token detail: identity + market facts + verified pools + web presence.
const PublicToken: React.FC<PublicProps> = ({ token: t, pools, web, organicity }) => {
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

                <TokenWebPresenceCard web={web} />

                <TokenOrganicityCard s={organicity} />

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
            `}</style>
        </Layout>
    )
}

const OperatorToken: React.FC<OperatorProps> = (props) => {
    const router = useRouter()
    const t = props.token;
    const [currentStatus, setCurrentStatus] = useState(t.status)
    const [scanning, setScanning] = useState(false)
    useEffect(() => { setCurrentStatus(t.status) }, [t.status])

    // On-demand security scan: force GoPlus + Honeypot.is + source-verified for this
    // one token (bypasses the batch gates), then reload to show the fresh signals.
    async function onSecurityScan() {
        setScanning(true)
        try {
            const r = await fetch('/api/admin/scantoken', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tokenid: t.id }),
            }).then((x) => x.json())
            if (r.success) {
                NotificationManager.success("Scan complete", "Security signals updated", 4000)
                router.reload()
            } else {
                NotificationManager.error("Scan failed", r.err || "", 6000)
                setScanning(false)
            }
        } catch (e) {
            NotificationManager.error("Scan failed", String(e), 6000)
            setScanning(false)
        }
    }

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

    // The canonical + scam passes are conditionally skipped (not failed), so surface
    // WHY — a borderline token under review shouldn't read as "pipeline didn't run".
    // Canonical needs a CoinGecko id (it resolves CG's canonical contract); without
    // one there's nothing to resolve. Scam only scans tokens in a verified pair (a
    // flag only acts by demoting a verified pair) — so it's skipped, not pending,
    // until the pool is verified.
    const inVerifiedPair = verifiedPools > 0;
    const canonicalChecked = t.canonicalCheckedAt > 0;
    const canonicalValue = canonicalChecked ? "resolved" : cgId ? "pending" : "n/a — not on CoinGecko";
    const scamChecked = t.scamCheckedAt > 0;
    const scamValue = t.isScamFlagged ? "flagged" : scamChecked ? "clear" : inVerifiedPair ? "pending" : "skipped — verify the pool to scan";

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
                            <TrustRow label="Canonical address" tone={canonicalChecked ? "pass" : "skip"} value={canonicalValue} detail={!canonicalChecked && !cgId ? "the canonical check resolves a CoinGecko-listed token's contract — n/a here" : undefined} />
                            <TrustRow label="Scam scan (GoPlus)" tone={t.isScamFlagged ? "fail" : scamChecked ? "pass" : "skip"} value={scamValue} detail={t.isScamFlagged ? t.scamReason : !scamChecked && !inVerifiedPair ? "the scam pass only scans tokens in a verified pair (to save GoPlus quota)" : undefined} />
                            <TrustRow label="Decimals" tone={t.decimals >= 0 && t.decimals <= 36 ? "pass" : "fail"} value={String(t.decimals)} />
                            <TrustRow label="Age" tone="skip" value={ageStr(t.deploymentTimestamp)} />
                            {t.securitySignals && (
                                <>
                                    <TrustRow
                                        label="Honeypot.is"
                                        tone={t.securitySignals.honeypot.error ? "skip" : t.securitySignals.honeypot.isHoneypot ? "fail" : "pass"}
                                        value={t.securitySignals.honeypot.error ? "n/a" : t.securitySignals.honeypot.isHoneypot ? "honeypot" : `clean${hpTax(t.securitySignals.honeypot)}`}
                                        detail={t.securitySignals.honeypot.reason || t.securitySignals.honeypot.error || undefined}
                                    />
                                    <TrustRow
                                        label="Source verified"
                                        tone={t.securitySignals.sourceVerified.error ? "skip" : t.securitySignals.sourceVerified.verified ? "pass" : "warn"}
                                        value={t.securitySignals.sourceVerified.error ? "n/a" : t.securitySignals.sourceVerified.verified ? `verified${t.securitySignals.sourceVerified.isProxy ? " · proxy" : ""}` : "unverified"}
                                        detail={t.securitySignals.sourceVerified.contractName || t.securitySignals.sourceVerified.error || undefined}
                                    />
                                </>
                            )}
                        </div>
                        <div className="row gap-3 items-center wrap" style={{ marginTop: "var(--sp-4)" }}>
                            <button type="button" className="btn btn-ghost btn-sm" disabled={scanning} onClick={onSecurityScan}>
                                <Icon name="refresh" size={13} />{scanning ? "Scanning…" : "Run security scan"}
                            </button>
                            <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                                {t.securityCheckedAt > 0 ? `GoPlus + Honeypot.is + source-verified · last run ${ageStr(t.securityCheckedAt)} ago` : "force GoPlus + Honeypot.is + source-verified for this token"}
                            </span>
                        </div>
                    </div>

                    <TokenWebPresenceCard web={props.web} />

                    <TokenOrganicityCard s={props.organicity} />

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
