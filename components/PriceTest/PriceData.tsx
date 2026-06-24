import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

import { aliasPairLabel, targetSideSymbol } from "../../lib/aliasGroups";
import { usd, num as fmtNum, ageStr } from "../../lib/format";
import { PoolPriceRow } from "../../lib/priceFetch";
import {
    aggregatePrices,
    getStats,
    scientificToDecimal,
    OutlierMethod,
} from "../../lib/stats"
import { PairProps } from "../../types/props";
import ChainName from "../ChainName";
import DexName from "../DexName";
import DataTable, { Column } from "../ui/DataTable";

type PoolPrice = {
    id: string;
    chain: string;
    dex: string;
    token0Symbol: string;
    token0Price: string;
    token1Symbol: string;
    token1Price: string;
    pId: string | null;
    t0Id: string | null;
    t1Id: string | null;
    pairName: string | null;
    reserveUsd: number;
    // The pool's target-side symbol — the query target for an exact pair, or the pool's own
    // dollar/ether/bitcoin token symbol for an alias-class query (so orientation survives whichever
    // side that token sits on). See lib/aliasGroups.targetSideSymbol.
    targetSymbol: string;
};

type ContractMap = Record<string, Record<string, string[]>>;

// One (chain,dex) fetch result, normalised. A failed or non-JSON group becomes { success:false }
// with an error string so one timed-out venue can't sink the whole price test.
type GroupResult = { success: boolean; chain: string; dex: string; prices: PoolPriceRow[]; error?: string; fetchedAt?: number };

const METHODS: { key: OutlierMethod; label: string; robust?: boolean }[] = [
    { key: "none", label: "Naive mean" },
    { key: "chauvenet", label: "Chauvenet", robust: true },
    { key: "mad", label: "Robust (MAD)", robust: true },
    { key: "iqd", label: "IQD", robust: true },
    { key: "peirce", label: "Peirce", robust: true },
];

// Price grid wants 4 dp; the shared formatter defaults to 0.
const num = (n: number) => fmtNum(n, 4);

const PriceData: React.FC<{
    base: string,
    target: string,
    pairs: PairProps[],
    isPublic?: boolean,
}> = ({ base, target, pairs, isPublic = false }) => {

    const [isFetching, setIsFetching] = useState(true)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)
    const [priceTableData, setPriceTableData] = useState<PoolPrice[]>([]);
    const [outlierMethod, setOutlierMethod] = useState<OutlierMethod>("mad") // MAD is the robust default
    const [dMax, setDMax] = useState(1)
    const [minsOfData, setMinsOfData] = useState(0)
    const [weightByLiquidity, setWeightByLiquidity] = useState(true)
    // Public path: prices come from the 7-day-cached /api/ooo/v1/prices; track the
    // oldest cache stamp across the (chain,dex) groups for the "cached" banner.
    const [cacheFetchedAt, setCacheFetchedAt] = useState<number | null>(null)
    // Venues this EVM-subgraph preview can't price (Cosmos "custom" sources, or a temporarily-down
    // subgraph). Non-fatal: the rest still aggregate. Important for alias queries, whose member pools
    // can span Cosmos chains the live oracle prices but this preview does not.
    const [skipped, setSkipped] = useState<{ chain: string; dex: string; error: string }[]>([])
    // Bumped by the "Try again" buttons to re-run the fetch effect in place (re-showing the spinner)
    // without a full page reload — useful for the transient gateway-timeout case on big alias queries.
    const [reloadNonce, setReloadNonce] = useState(0)

    // An asset-class query (both sides are curated alias classes, e.g. ETH/USD) — orient each pool by
    // cg-id class membership rather than by matching the literal "USD"/"ETH" against a real symbol.
    const isAlias = aliasPairLabel(base, target) !== null

    // Group contract addresses by (chain, dex). Memoised so the fetch effect's
    // dependency is stable.
    const contractList = useMemo<ContractMap>(() => {
        const map: ContractMap = {}
        for (const p of pairs) {
            if (map[p.chain] === undefined) map[p.chain] = {}
            if (map[p.chain][p.dex] === undefined) map[p.chain][p.dex] = []
            map[p.chain][p.dex].push(p.contractAddress)
        }
        return map
    }, [pairs])

    useEffect(() => {
        const controller = new AbortController()
        setIsFetching(true)
        setErrorMsg(null)

        // Public uses the 7-day-cached endpoint (latest-only — no `mins`); operator
        // uses the live admin endpoint with the chosen minutes of history.
        const pricesBase = isPublic ? "/api/ooo/v1/prices" : "/api/admin/getprices"
        const minsParam = isPublic ? "" : `&mins=${minsOfData}`
        const endpoints: { url: string; chain: string; dex: string }[] = []
        for (const chain in contractList) {
            const chainDexs = contractList[chain];
            for (const dex in chainDexs) {
                const contracts = chainDexs[dex]
                const url = `${pricesBase}?chain=${chain}&dex=${dex}&addresses=${contracts.join(",")}${minsParam}`
                endpoints.push({ url, chain, dex })
            }
        }

        function getPairInfo(c, d, cAddr) {
            let pId = null
            let t0Id = null
            let t1Id = null
            let pairName = null
            let reserveUsd = 0
            let targetSymbol = target
            for (let i = 0; i < pairs.length; i += 1) {
                const p = pairs[i]
                // Case-insensitive identifier match — works for both EVM addresses and Cosmos denoms
                // (toChecksumAddress would throw on a non-hex denom like factory/.../allBTC).
                if (p.chain === c && p.dex === d && String(p.contractAddress).toLowerCase() === String(cAddr).toLowerCase()) {
                    pId = p.id; t0Id = p.token0Id; t1Id = p.token1Id; pairName = p.pair; reserveUsd = p.reserveUsd
                    // For an alias query, the target side is this pool's own class token (USDC/USDT/…),
                    // not the literal "USD"; for an exact query it stays the queried target symbol.
                    targetSymbol = targetSideSymbol({ token0: p.token0, token1: p.token1 }, target, isAlias)
                    break
                }
            }
            return { pId, t0Id, t1Id, pairName, reserveUsd, targetSymbol }
        }

        // Fetch one (chain,dex) group, tolerant of failure. A proxy/gateway timeout returns an HTML
        // error page, not JSON, and calling .json() on it throws "Unexpected token '<'". Under the old
        // blanket Promise.all(.json()) that single bad response rejected the whole batch and failed the
        // entire test (this is the ETH.USD production error). Parse each group defensively instead and
        // turn any non-OK / non-JSON group into a non-fatal skip — the same treatment an explicit
        // { success:false } group already gets — so the venues that did respond still aggregate.
        async function fetchGroup({ url, chain, dex }: { url: string; chain: string; dex: string }): Promise<GroupResult> {
            try {
                const resp = await fetch(url, { signal: controller.signal })
                const text = await resp.text()
                let body = null
                try { body = JSON.parse(text) } catch { /* not JSON — e.g. an HTML gateway-timeout page */ }
                if (!resp.ok || !body || typeof body !== "object") {
                    const error = !resp.ok ? `request failed (HTTP ${resp.status})` : "the server returned an unexpected response (it may have timed out)"
                    return { success: false, chain, dex, prices: [], error }
                }
                return {
                    success: body.success === true,
                    chain: body.chain || chain,
                    dex: body.dex || dex,
                    prices: Array.isArray(body.prices) ? body.prices : [],
                    error: body.error,
                    fetchedAt: body.fetchedAt,
                }
            } catch (e) {
                if ((e as { name?: string })?.name === "AbortError") throw e
                return { success: false, chain, dex, prices: [], error: (e as Error)?.message || "request failed" }
            }
        }

        Promise.all(endpoints.map(fetchGroup))
            .then(data => {
                const pd: PoolPrice[] = []
                // A failed (chain,dex) group is NON-fatal — skip it and keep aggregating the rest, so
                // one unpriceable Cosmos venue (or a temporarily-down subgraph) can't wipe out the
                // whole price test. Catastrophic failures are caught below and shown as a hard error.
                const skips: { chain: string; dex: string; error: string }[] = []
                for (let i = 0; i < data.length; i += 1) {
                    const d = data[i]
                    if (d.success) {
                        for (let j = 0; j < d.prices.length; j += 1) {
                            const { pId, t0Id, t1Id, pairName, reserveUsd, targetSymbol } = getPairInfo(d.prices[j].chain, d.prices[j].dex, d.prices[j].pairContractAddress)
                            pd.push({
                                id: `price_${d.chain}_${d.dex}_${j}`,
                                chain: d.chain,
                                dex: d.dex,
                                token0Symbol: d.prices[j].token0Symbol,
                                token0Price: d.prices[j].token0Price,
                                token1Symbol: d.prices[j].token1Symbol,
                                token1Price: d.prices[j].token1Price,
                                pId, t0Id, t1Id, pairName, reserveUsd, targetSymbol,
                            })
                        }
                    } else {
                        skips.push({ chain: d.chain, dex: d.dex, error: d.error })
                    }
                }
                if (isPublic) {
                    const stamps = data.filter((d) => d.success && typeof d.fetchedAt === "number").map((d) => d.fetchedAt as number)
                    setCacheFetchedAt(stamps.length ? Math.min(...stamps) : null)
                }
                setPriceTableData(pd)
                setSkipped(skips)
                setIsFetching(false)
            })
            .catch(e => {
                if (e.name === "AbortError") return
                console.log(e)
                setErrorMsg(e.message)
                setIsFetching(false)
            });

        return () => controller.abort()
    }, [pairs, contractList, minsOfData, isPublic, target, isAlias, reloadNonce]);

    // THE single aggregation, computed in render: per-pool samples (price + pool
    // liquidity) → outlier removal by each method → (liquidity-weighted) mean of
    // survivors. The selected method drives the headline; the others fill the
    // comparison cards. MAD + weighting is the go-ooo default.
    // Orient by the pool's resolved target-side symbol (= the query target for an exact pair; the
    // pool's own class token for an alias query) so an alias pool prices the right way up whichever
    // side its dollar/ether/bitcoin token sits on.
    const targetPrice = (p: PoolPrice) => parseFloat(p.targetSymbol === p.token0Symbol ? p.token0Price : p.token1Price)
    const samples = useMemo(() => priceTableData.map((p) => ({ price: targetPrice(p), liquidity: p.reserveUsd ?? 0 })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [priceTableData, target])
    const methodCards = useMemo(() => METHODS.map((m) => ({ ...m, r: aggregatePrices(samples, { method: m.key, weightByLiquidity, chauvenetDMax: dMax }) })),
        [samples, weightByLiquidity, dMax])
    const result = useMemo(() => aggregatePrices(samples, { method: outlierMethod, weightByLiquidity, chauvenetDMax: dMax }),
        [samples, outlierMethod, weightByLiquidity, dMax])
    const statsBefore = useMemo(() => getStats(samples.map((s) => s.price)), [samples])
    const statsAfter = useMemo(() => getStats(result.kept.map((s) => s.price)), [result])
    const rejectedSet = useMemo(() => new Set(result.rejected.map((s) => s.price)), [result])

    const poolCols: Column<PoolPrice>[] = [
        { key: "chain", label: "Chain", render: (p) => <ChainName chain={p.chain} /> },
        { key: "dex", label: "DEX", render: (p) => <DexName dex={p.dex} /> },
        { key: "pairName", label: "Pair", sortable: true, render: (p) => p.pId ? <Link href={`/p/${p.pId}`}><a>{p.pairName}</a></Link> : <>{p.pairName}</> },
        { key: "price", label: `${base}→${target}`, num: true, sortable: true, sortVal: (p) => targetPrice(p), render: (p) => scientificToDecimal(targetPrice(p)) },
        { key: "reserveUsd", label: "Liquidity", num: true, sortable: true, render: (p) => usd(p.reserveUsd) },
        { key: "used", label: "In calc", render: (p) => rejectedSet.has(targetPrice(p)) ? <span className="badge badge-fail badge-sm">rejected</span> : <span className="badge badge-pass badge-sm">used</span> },
    ]

    // Shared by the error / empty states below — re-runs the fetch effect in place (re-shows the spinner).
    const tryAgainBtn = (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReloadNonce((n) => n + 1)}>Try again</button>
    )

    if (isFetching) return (
        <div className="card card-pad loading-card">
            <span className="spinner" aria-hidden="true" />
            <div>
                <h2 className="loading-title">Processing — please wait…</h2>
                <p className="muted loading-sub">Pricing every backing pool across chains and DEXs. Large asset-class queries (like <span className="mono">ETH→USD</span>) can take a few seconds the first time.</p>
            </div>
            <style jsx>{`
                .loading-card { display: flex; align-items: center; gap: var(--sp-4); }
                .loading-title { margin: 0; font-size: var(--fs-lg); }
                .loading-sub { margin: var(--sp-1) 0 0; font-size: var(--fs-sm); max-width: 56ch; }
                .spinner { width: 22px; height: 22px; flex: none; border-radius: 50%; border: 3px solid var(--border); border-top-color: var(--accent-text, var(--brand-2)); animation: spin .8s linear infinite; }
                @keyframes spin { to { transform: rotate(360deg); } }
                @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } }
            `}</style>
        </div>
    )
    if (errorMsg !== null) return (
        <div className="card card-pad">
            <h3 style={{ color: "var(--fail)" }}>Error fetching data</h3>
            <p className="muted">{errorMsg}</p>
            <div style={{ marginTop: "var(--sp-4)" }}>{tryAgainBtn}</div>
        </div>
    )
    // No priceable pools — say so plainly rather than rendering a misleading "1 ETH = 0" headline from an
    // empty sample set. Two sub-cases: some venues were skipped (timed out / unreachable / non-EVM), or
    // every venue responded but with no price data.
    if (priceTableData.length === 0 && skipped.length > 0) return (
        <div className="card card-pad" style={{ maxWidth: 640 }}>
            <h3 style={{ marginTop: 0 }}>No prices available right now</h3>
            <p className="muted">
                None of the backing venues could be priced just now:{" "}
                <span className="mono">{skipped.map((s) => `${s.chain}/${s.dex}`).join(", ")}</span>. This is often
                temporary — a subgraph being slow or briefly unavailable — so it&apos;s worth trying again in a
                moment. (The public simulator also prices EVM subgraph pools only; Cosmos pools are priced by the
                live oracle, not here.)
            </p>
            <div style={{ marginTop: "var(--sp-4)" }}>{tryAgainBtn}</div>
        </div>
    )
    if (priceTableData.length === 0) return (
        <div className="card card-pad" style={{ maxWidth: 640 }}>
            <h3 style={{ marginTop: 0 }}>No pool prices returned</h3>
            <p className="muted">The backing pools returned no price data this time. This is usually temporary — please try again shortly.</p>
            <div style={{ marginTop: "var(--sp-4)" }}>{tryAgainBtn}</div>
        </div>
    )

    return (
        <div key={`price-data-results-${base}-${target}`}>
            {isPublic && (
                <div className="cached-note">
                    Showing <strong>cached</strong> prices{cacheFetchedAt ? ` — last refreshed ${ageStr(cacheFetchedAt)} ago` : ""}, not real-time. The public simulator refreshes each pair&apos;s prices at most once every 7 days.
                </div>
            )}
            {skipped.length > 0 && (
                <div className="skip-note">
                    Priced {priceTableData.length} pool{priceTableData.length === 1 ? "" : "s"} across the EVM venues. {skipped.length} venue{skipped.length === 1 ? "" : "s"} could not be priced by this preview
                    (<span className="mono">{skipped.map((s) => `${s.chain}/${s.dex}`).join(", ")}</span>) — Cosmos pools and any temporarily-unavailable subgraph are priced by the live oracle only.
                </div>
            )}
            {/* Controls */}
            <div className="card card-pad pt-controls">
                {!isPublic && (
                    <label className="ctl">
                        <span className="ctl-label">Minutes of data</span>
                        <select className="input" defaultValue={minsOfData} onChange={(e) => setMinsOfData(parseInt(e.target.value))}>
                            {Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i === 0 ? "0 (latest only)" : i}</option>)}
                        </select>
                    </label>
                )}
                {outlierMethod === "chauvenet" && (
                    <label className="ctl">
                        <span className="ctl-label">Chauvenet dMax</span>
                        <select className="input" defaultValue={dMax} onChange={(e) => setDMax(parseInt(e.target.value))}>
                            {[1, 2, 3, 4].map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </label>
                )}
                <label className="ctl ctl-toggle">
                    <input type="checkbox" className="ckbox" checked={weightByLiquidity} onChange={(e) => setWeightByLiquidity(e.target.checked)} />
                    <span>Weight by liquidity (deeper pools count more)</span>
                </label>
            </div>

            {/* Method comparison cards — click to select */}
            <div className="method-cards">
                {methodCards.map((m) => (
                    <button key={m.key} type="button" className={`mcard card${m.key === outlierMethod ? " sel" : ""}`} onClick={() => setOutlierMethod(m.key)}>
                        <div className="row spread items-center">
                            <span className="mc-label">{m.label}</span>
                            {m.robust ? <span className="mc-tag">robust</span> : null}
                        </div>
                        <div className="mc-price mono">{scientificToDecimal(m.r.price)}</div>
                        <div className="mc-sub muted">{m.r.nUsed} used · {m.r.nRejected} rejected</div>
                    </button>
                ))}
            </div>

            {/* Result callout */}
            <div className="card card-pad result">
                <span className="eyebrow">Resulting oracle price</span>
                <div className="result-price mono">1 {base} = {scientificToDecimal(result.price)} {target}</div>
                <div className="muted">
                    {METHODS.find((m) => m.key === outlierMethod)?.label} outlier removal{weightByLiquidity ? " + liquidity-weighted mean" : " + plain mean"}
                    {outlierMethod === "chauvenet" ? ` (dMax ${dMax})` : ""} · {result.nUsed} pools used, {result.nRejected} rejected
                </div>
            </div>

            {/* Per-pool prices */}
            <div className="card card-pad" style={{ marginTop: "var(--sp-5)" }}>
                <span className="eyebrow" style={{ display: "block", marginBottom: "var(--sp-3)" }}>Per-pool prices ({result.nUsed} used · {result.nRejected} rejected)</span>
                <DataTable columns={poolCols} data={priceTableData} rowKey={(p) => p.id} sortInit={{ key: "reserveUsd", dir: "desc" }} empty="No pool prices." />
            </div>

            {/* Stats before / after */}
            <div className="stats-grid">
                {[{ t: "Before outlier removal", s: statsBefore }, { t: "After outlier removal", s: statsAfter }].map((blk) => (
                    <div key={blk.t} className="card card-pad">
                        <span className="eyebrow">{blk.t}</span>
                        <div className="kv-grid">
                            <div className="kv-row"><span className="muted">n</span><span className="mono">{blk.s.n}</span></div>
                            <div className="kv-row"><span className="muted">Mean</span><span className="mono">{num(blk.s.mean)}</span></div>
                            <div className="kv-row"><span className="muted">Std dev</span><span className="mono">{num(blk.s.stdDev)}</span></div>
                            <div className="kv-row"><span className="muted">Variance</span><span className="mono">{num(blk.s.variance)}</span></div>
                        </div>
                    </div>
                ))}
            </div>

            <style jsx>{`
                .cached-note { padding: var(--sp-3) var(--sp-4); margin-bottom: var(--sp-4); border: 1px solid var(--warn-line, var(--warn)); background: var(--warn-dim, rgba(245,184,61,.1)); border-radius: var(--r-md); font-size: var(--fs-sm); color: var(--text-1); }
                .skip-note { padding: var(--sp-3) var(--sp-4); margin-bottom: var(--sp-4); border: 1px solid var(--border); background: var(--surface-2, rgba(127,127,127,.06)); border-radius: var(--r-md); font-size: var(--fs-sm); color: var(--text-2); }
                .pt-controls { display: flex; gap: var(--sp-6); align-items: flex-end; flex-wrap: wrap; margin-bottom: var(--sp-5); }
                .ctl { display: flex; flex-direction: column; gap: var(--sp-2); }
                .ctl-label { font-size: var(--fs-xs); color: var(--text-2); text-transform: uppercase; letter-spacing: .04em; }
                .ctl-toggle { flex-direction: row; align-items: center; gap: var(--sp-3); font-size: var(--fs-sm); }
                .method-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--sp-4); margin-bottom: var(--sp-5); }
                .mcard { text-align: left; padding: var(--sp-5); cursor: pointer; border: 1px solid var(--border); color: var(--text-0); }
                .mcard.sel { border-color: var(--accent-line); background: var(--accent-dim); }
                .mc-label { font-weight: 600; font-size: var(--fs-sm); }
                .mc-tag { font-size: var(--fs-xs); color: var(--brand-2); border: 1px solid var(--brand-2); border-radius: var(--r-pill); padding: 0 6px; }
                .mc-price { font-size: var(--fs-lg); font-weight: 700; margin: var(--sp-3) 0 var(--sp-1); }
                .mc-sub { font-size: var(--fs-xs); }
                .result { margin-bottom: var(--sp-3); border-color: var(--accent-line); }
                .result-price { font-size: var(--fs-2xl); font-weight: 700; color: var(--accent-text); margin: var(--sp-2) 0; }
                .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-4); margin-top: var(--sp-5); }
                .kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 var(--sp-7); padding-top: var(--sp-3); }
                .kv-row { display: flex; justify-content: space-between; padding: var(--sp-2) 0; border-bottom: 1px solid var(--border); font-size: var(--fs-sm); }
                @media (max-width: 720px) { .stats-grid { grid-template-columns: 1fr; } }
            `}</style>
        </div>
    )
}

export default PriceData;
