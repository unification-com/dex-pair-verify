import { GetServerSideProps } from "next"
import { useRouter } from "next/router";
import React, { FormEvent, useEffect, useState } from "react"
import { NotificationManager } from 'react-notifications';

import ChainName from "../../../components/ChainName";
import CoinGeckoCoinLink from "../../../components/CoinGeckoCoinLink";
import ExplorerUrl from "../../../components/ExplorerUrl";
import Layout from "../../../components/shell/Layout"
import DataTable, { Column } from "../../../components/ui/DataTable";
import Icon from "../../../components/ui/Icon";
import PageHeader from "../../../components/ui/PageHeader";
import StatusBadge from "../../../components/ui/StatusBadge";
import prisma from '../../../lib/prisma';
import { AssociatedPairProps, TokenProps } from "../../../types/props";
import { TokenPairStatus } from "../../../types/types";

const pairSelect = {
    pair: true, id: true, contractAddress: true, reserveUsd: true, reserve0: true,
    reserve1: true, reserveNativeCurrency: true, volumeUsd: true, txCount: true, status: true, dex: true,
};

export const getServerSideProps: GetServerSideProps = async ({ params }) => {
    const token = await prisma.token.findUnique({
        where: { id: String(params?.id) },
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
    return { props: { token, similarTokens } }
}

type Props = {
    token: TokenProps;
    similarTokens: TokenProps[];
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
    <div className="kv-row"><span className="muted">{k}</span><span className="mono" style={{ textAlign: "right" }}>{v}</span></div>
);

const Token: React.FC<Props> = (props) => {
    const router = useRouter()
    const [currentStatus, setCurrentStatus] = useState(props.token.status)
    useEffect(() => { setCurrentStatus(props.token.status) }, [props.token.status])

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

    const duplicateTokens: TokenProps[] = (props.token.duplicateTokenSymbols || []).map((d) => d.duplicateToken)
    const associatedPairs: AssociatedPairProps[] = props.token.pairsToken1.concat(props.token.pairsToken0)

    const tokenCols: Column<TokenProps>[] = [
        { key: "symbol", label: "Symbol", sortable: true, render: (t) => <span style={{ fontWeight: 600 }}>{t.symbol}</span> },
        { key: "name", label: "Name", sortable: true },
        { key: "coingeckoCoinId", label: "CG ID", render: (t) => <CoinGeckoCoinLink coingeckoId={t.coingeckoCoinId} /> },
        { key: "marketCapUsd", label: "Market cap", num: true, sortable: true, render: (t) => usd(t.marketCapUsd) },
        { key: "volume24hUsd", label: "24h Vol", num: true, sortable: true, render: (t) => usd(t.volume24hUsd) },
        { key: "status", label: "Status", render: (t) => <StatusBadge status={t.status} size="sm" /> },
    ]
    const similarCols: Column<TokenProps>[] = [
        { key: "chain", label: "Chain", render: (t) => <ChainName chain={t.chain} /> },
        ...tokenCols,
    ]
    const pairCols: Column<AssociatedPairProps>[] = [
        { key: "pair", label: "Pair", sortable: true, render: (p) => <span style={{ fontWeight: 600 }}>{p.pair}</span> },
        { key: "dex", label: "DEX", sortable: true },
        { key: "reserveUsd", label: "Reserve", num: true, sortable: true, render: (p) => usd(p.reserveUsd) },
        { key: "txCount", label: "Tx", num: true, sortable: true, render: (p) => num(p.txCount) },
        { key: "volumeUsd", label: "Volume", num: true, sortable: true, render: (p) => usd(p.volumeUsd) },
        { key: "status", label: "Status", render: (p) => <StatusBadge status={p.status} size="sm" /> },
    ]

    return (
        <Layout crumb="Token">
            <PageHeader
                title={props.token.symbol}
                badge={<StatusBadge status={currentStatus} method={props.token.verificationMethod} />}
                sub={<span className="row gap-3 wrap items-center">
                    {props.token.name} · <ChainName chain={props.token.chain} /> ·{" "}
                    <ExplorerUrl chain={props.token.chain} contractAddress={props.token.contractAddress} linkType={"token"} /> ·{" "}
                    <CoinGeckoCoinLink coingeckoId={props.token.coingeckoCoinId} />
                </span>}
            />

            <div className="tok-grid">
                <div className="tok-main">
                    {props.token.isScamFlagged && (
                        <div className="card card-pad scam-callout">
                            <span className="badge badge-fail"><span className="glyph">⚠</span>Scam-flagged</span>
                            <p style={{ margin: "var(--sp-3) 0 0", color: "var(--fail)" }}>{props.token.scamReason}</p>
                        </div>
                    )}

                    <div className="card card-pad">
                        <span className="eyebrow">Stats</span>
                        <div className="kv-grid">
                            <KV k="Tx count" v={num(props.token.txCount)} />
                            <KV k="Market cap" v={usd(props.token.marketCapUsd)} />
                            <KV k="Total supply" v={num(props.token.totalSupply / (10 ** props.token.decimals))} />
                            <KV k="24h volume" v={usd(props.token.volume24hUsd)} />
                            <KV k="Decimals" v={props.token.decimals} />
                        </div>
                    </div>

                    {props.token.scamCheckedAt > 0 && props.token.goPlusData && (
                        <details className="card raw">
                            <summary>GoPlus security signals</summary>
                            <div className="kv-grid">
                                {Object.entries(props.token.goPlusData)
                                    .filter(([, v]) => typeof v === "string" || typeof v === "number")
                                    .map(([k, v]) => <KV key={`gp_${k}`} k={k} v={String(v)} />)}
                            </div>
                        </details>
                    )}

                    <div className="card card-pad">
                        <span className="eyebrow" style={{ marginBottom: "var(--sp-3)", display: "block" }}>Associated pairs ({associatedPairs.length})</span>
                        <DataTable columns={pairCols} data={associatedPairs} rowKey={(p) => p.id} onRowClick={(p) => router.push(`/admin/p/${p.id}`)} sortInit={{ key: "reserveUsd", dir: "desc" }} empty="No pairs." />
                    </div>

                    {duplicateTokens.length > 0 && (
                        <details className="card raw">
                            <summary>Possible duplicates on {props.token.chain} ({duplicateTokens.length})</summary>
                            <DataTable columns={tokenCols} data={duplicateTokens} rowKey={(t) => t.id} onRowClick={(t) => router.push(`/admin/t/${t.id}`)} />
                        </details>
                    )}
                    {props.similarTokens.length > 0 && (
                        <details className="card raw">
                            <summary>Similar tokens on other chains ({props.similarTokens.length})</summary>
                            <DataTable columns={similarCols} data={props.similarTokens} rowKey={(t) => t.id} onRowClick={(t) => router.push(`/admin/t/${t.id}`)} />
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
                            <input type="text" name="comment" defaultValue={props.token.verificationComment} placeholder="optional comment" className="input" />
                            <input type="hidden" name="tokenid" value={props.token.id} />
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
                .raw { padding: var(--sp-4) var(--sp-5); }
                .raw > summary { cursor: pointer; font-weight: 600; font-size: var(--fs-sm); color: var(--text-1); }
                @media (max-width: 1024px) { .tok-grid { grid-template-columns: 1fr; } .tok-rail { position: static; } }
            `}</style>
        </Layout>
    )
}

export default Token;
