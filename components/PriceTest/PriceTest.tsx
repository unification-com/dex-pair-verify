import Link from "next/link";
import { useRouter } from "next/router";
import React, { useEffect, useState } from "react";

import PriceData from "./PriceData";
import { usd, num } from "../../lib/format";
import { PairProps } from "../../types/props";
import ChainName from "../ChainName";
import DexName from "../DexName";
import DataTable, { Column } from "../ui/DataTable";
import PageHeader from "../ui/PageHeader";

const PriceTest: React.FC<{
    base: string,
    target: string,
    usablePairs: PairProps[],
    ignoredPairs: PairProps[],
    isPublic?: boolean,
}> = ({ base, target, usablePairs, ignoredPairs, isPublic = false }) => {
    const router = useRouter()
    const [usable, setUsable] = useState(usablePairs)
    const [ignored, setIgnored] = useState(ignoredPairs)

    useEffect(() => {
        setUsable(usablePairs)
        setIgnored(ignoredPairs)
    }, [usablePairs, ignoredPairs]);

    const cols: Column<PairProps>[] = [
        { key: "chain", label: "Chain", render: (p) => <ChainName chain={p.chain} /> },
        { key: "dex", label: "DEX", render: (p) => <DexName dex={p.dex} /> },
        { key: "pair", label: "Pair", sortable: true },
        { key: "reserveUsd", label: "Reserve", num: true, sortable: true, render: (p) => usd(p.reserveUsd) },
        { key: "txCount", label: "Tx", num: true, sortable: true, render: (p) => num(p.txCount) },
        { key: "buys24h", label: "Buys", num: true, sortable: true, render: (p) => num(p.buys24h) },
        { key: "sells24h", label: "Sells", num: true, sortable: true, render: (p) => num(p.sells24h) },
    ]

    return (
        <div key={`pair_price_test_${base}-${target}`}>
            <PageHeader
                title={<>OoO price-test <span className="mono">{base}→{target}</span></>}
                sub={<>Simulates the oracle price across every verified pool for this pair.</>}
                actions={<Link href={`/price-test/${target}/${base}`}><a className="btn btn-ghost btn-sm">Reverse → {target}→{base}</a></Link>}
            />

            {usable.length > 0 && (
                <details className="card raw" open>
                    <summary>Usable pools — above thresholds ({usable.length})</summary>
                    <DataTable columns={cols} data={usable} rowKey={(p) => p.id} onRowClick={(p) => router.push(`/p/${p.id}`)} sortInit={{ key: "reserveUsd", dir: "desc" }} />
                </details>
            )}
            {ignored.length > 0 && (
                <details className="card raw">
                    <summary>Ignored pools — reserve / tx below thresholds ({ignored.length})</summary>
                    <DataTable columns={cols} data={ignored} rowKey={(p) => p.id} onRowClick={(p) => router.push(`/p/${p.id}`)} />
                </details>
            )}

            <PriceData key={`price-data-${base}-${target}`} base={base} target={target} pairs={usable} isPublic={isPublic} />

            <style jsx>{`
                .raw { padding: var(--sp-4) var(--sp-5); margin-bottom: var(--sp-5); }
                .raw > summary { cursor: pointer; font-weight: 600; font-size: var(--fs-sm); color: var(--text-1); }
            `}</style>
        </div>
    )
}

export default PriceTest;
