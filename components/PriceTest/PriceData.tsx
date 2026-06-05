import React, {useEffect, useMemo, useState} from "react";
import {NumericFormat} from "react-number-format";
import {Web3} from "web3";

import {
    aggregatePrices,
    getStats,
    scientificToDecimal,
    OutlierMethod
} from "../../lib/stats"
import {PairProps} from "../../types/props";
import NoneSortableTable from "../SortableTable/NoneSortableTable";
import SortableTable from "../SortableTable/SortableTable";

type StatRow = {
    id: string;
    n: number;
    sum: number;
    mean: number;
    variance: number;
    stdDev: number;
};

type ContractMap = Record<string, Record<string, string[]>>;
const PriceData: React.FC<{
    base: string,
    target: string,
    pairs: PairProps[],
}> = ({ base, target, pairs }) => {

    const OUT_PEIRCE_CRITERION = "PeirceCriterion"
    const OUT_NONE = "None"
    const OUT_IDQ = "IDQ"
    const OUT_CHAUVENET = "Chauvenet"
    const OUT_MAD = "MAD"

    // Map the UI label to the lib's OutlierMethod key.
    const methodKey = (m: string): OutlierMethod => {
        switch (m) {
            case OUT_MAD: return "mad"
            case OUT_CHAUVENET: return "chauvenet"
            case OUT_IDQ: return "iqd"
            case OUT_PEIRCE_CRITERION: return "peirce"
            default: return "none"
        }
    }

    const [isFetching, setIsFetching] = useState(true)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)
    const [priceTableData, setPriceTableData] = useState([]);
    const [removedPrices, setRemovedPrices] = useState<number[]>([])
    const [finalPrice, setFinalPrice] = useState(0)
    const [statsBefore, setStatsBefore] = useState<StatRow>(
        {
            id: "stats-before",
            mean: 0,
            n: 0,
            stdDev: 0,
            sum: 0,
            variance: 0,
        }
    )
    const [statsAfter, setStatsAfter] = useState<StatRow>(
        {
            id: "stats-after",
            mean: 0,
            n: 0,
            stdDev: 0,
            sum: 0,
            variance: 0,
        }
    )
    const [outlierMethod, setOutlierMethod] = useState(OUT_MAD) // MAD is the robust default
    const [dMax, setDMax] = useState(1)
    const [minsOfData, setMinsOfData] = useState(0)
    const [weightByLiquidity, setWeightByLiquidity] = useState(true)
    const [aggInfo, setAggInfo] = useState({ nUsed: 0, nRejected: 0 })

    // Group contract addresses by (chain, dex). Memoised so it isn't rebuilt
    // on every render (and so the fetch effect's dependency is stable).
    const contractList = useMemo<ContractMap>(() => {
        const map: ContractMap = {}
        for (const p of pairs) {
            if (map[p.chain] === undefined) {
                map[p.chain] = {}
            }
            if (map[p.chain][p.dex] === undefined) {
                map[p.chain][p.dex] = []
            }
            map[p.chain][p.dex].push(p.contractAddress)
        }
        return map
    }, [pairs])

    useEffect(() => {
        const controller = new AbortController()
        setIsFetching(true)
        setErrorMsg(null)

        const endpoints = []
        for (const chain in contractList) {
            const chainDexs = contractList[chain];
            for (const dex in chainDexs) {
                const contracts = chainDexs[dex]
                const url = `/api/admin/getprices?chain=${chain}&dex=${dex}&addresses=${contracts.join(",")}&mins=${minsOfData}`
                endpoints.push(url)
            }
        }

        function getPairInfo(c, d, cAddr) {
            let pId = null
            let t0Id = null
            let t1Id = null
            let pairName = null
            let reserveUsd = 0

            for(let i = 0; i < pairs.length; i += 1) {
                const p = pairs[i]
                if(p.chain === c && p.dex === d && Web3.utils.toChecksumAddress(p.contractAddress) === Web3.utils.toChecksumAddress(cAddr)) {
                    pId = p.id
                    t0Id = p.token0Id
                    t1Id = p.token1Id
                    pairName = p.pair
                    reserveUsd = p.reserveUsd
                    break
                }
            }

            return {pId, t0Id, t1Id, pairName, reserveUsd}
        }

        const fetchPromises = endpoints.map(endpoint => fetch(endpoint, { signal: controller.signal }));

        Promise.all(fetchPromises)
            .then(responses => Promise.all(responses.map(response => response.json())))
            .then(data => {
                // Merge and process the data
                const pd = []
                const fetchErrors = []
                for(let i = 0; i < data.length; i += 1) {
                    const d = data[i]
                    if(d.success) {
                        for(let j = 0; j < d.prices.length; j += 1) {

                            const {pId, t0Id, t1Id, pairName, reserveUsd} = getPairInfo(d.prices[j].chain, d.prices[j].dex, d.prices[j].pairContractAddress)
                            pd.push(
                                {
                                    id: `price_${d.chain}_${d.dex}_${j}`, // for cell/row data in sortable table
                                    chain: d.chain,
                                    dex: d.dex,
                                    token0Symbol: d.prices[j].token0Symbol,
                                    token0Price: d.prices[j].token0Price,
                                    token1Symbol: d.prices[j].token1Symbol,
                                    token1Price: d.prices[j].token1Price,
                                    pId,
                                    t0Id,
                                    t1Id,
                                    pairName,
                                    reserveUsd,
                                }
                            )
                        }
                    } else {
                        fetchErrors.push(`FETCH ERROR ${i}: ${d.chain}, ${d.dex}, ${d.addresses} - ${d.error}`)
                    }
                }
                if(fetchErrors.length > 0) {
                    setErrorMsg(fetchErrors.join(" | "))
                }
                setPriceTableData(pd)
                setIsFetching(false)
            })
            .catch(e => {
                // Ignore the abort thrown when a newer fetch supersedes this one.
                if (e.name === "AbortError") {
                    return
                }
                console.log(e)
                setErrorMsg(e.message)
                setIsFetching(false)
            });

        return () => controller.abort()
    }, [pairs, contractList, minsOfData]);

    // THE single aggregation: build per-pool samples (price + pool liquidity),
    // remove outliers by the SELECTED method, then take the (liquidity-weighted)
    // mean of the survivors. One number out. MAD + weighting is the go-ooo default.
    useEffect(() => {
        const samples = []
        for(let i = 0; i < priceTableData.length; i += 1) {
            const p = priceTableData[i]
            const price = parseFloat((target === p.token0Symbol) ? p.token0Price : p.token1Price)
            samples.push({ price, liquidity: p.reserveUsd ?? 0 })
        }
        const prices = samples.map((s) => s.price)

        const r = aggregatePrices(samples, { method: methodKey(outlierMethod), weightByLiquidity, chauvenetDMax: dMax })
        setFinalPrice(r.price)
        setAggInfo({ nUsed: r.nUsed, nRejected: r.nRejected })
        setRemovedPrices(r.rejected.map((s) => s.price))
        setStatsBefore({ ...getStats(prices), id: "stats-before" })
        setStatsAfter({ ...getStats(r.kept.map((s) => s.price)), id: "stats-after" })
        // methodKey is pure component-scoped logic; deps mirror the existing pattern.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [priceTableData, target, outlierMethod, dMax, weightByLiquidity]);

    const onOutlierMethodChange = (event) => {
        const value = event.target.value;
        setOutlierMethod(value);
    };

    const onDMaxChange = (event) => {
        const value = event.target.value;
        setDMax(parseInt(value))
    }
    const onMinutesDataChange = (event) => {
        const value = event.target.value;
        setMinsOfData(parseInt(value))
    }
    const onWeightChange = (event) => {
        setWeightByLiquidity(event.target.checked)
    }


    const columns = [
        {label: "Chain", accessor: "chain", sortable: true, sortbyOrder: "asc", cellType: "display"},
        {label: "Dex", accessor: "dex", sortable: true, sortbyOrder: "asc", cellType: "display"},
        {label: "Pair", accessor: "pairName", sortable: true, sortbyOrder: "asc", cellType: "display"},
        {label: "", accessor: "pId", sortable: false, cellType: "edit_link", meta: {url: "/p/__ID__", text: "View/Edit"} },
        {label: "Token 0", accessor: "token0Symbol", sortable: true, cellType: "display"},
        {label: "", accessor: "t0Id", sortable: false, cellType: "edit_link", meta: {url: "/t/__ID__", text: "View/Edit"} },
        {label: "Token 0 Price", accessor: "token0Price", sortable: true, cellType: "number_dp", dp: 10},
        {label: "Token 1", accessor: "token1Symbol", sortable: true, cellType: "display"},
        {label: "", accessor: "t1Id", sortable: false, cellType: "edit_link", meta: {url: "/t/__ID__", text: "View/Edit"} },
        {label: "Token 1 Price", accessor: "token1Price", sortable: true, cellType: "number_dp", dp: 10},
    ]

    const statsColumns = [
        {label: "Num. Prices Used", accessor: "n", sortable: true, cellType: "number_raw"},
        {label: "Sum", accessor: "sum", sortable: true, cellType: "number_raw"},
        {label: "Mean", accessor: "mean", sortable: true, cellType: "number_raw"},
        {label: "Std Deviation", accessor: "stdDev", sortable: true, cellType: "number_raw"},
        {label: "Variance", accessor: "variance", sortable: true, cellType: "number_raw"},
    ]

    if(isFetching) {
        return (
            <div>
                <h2>Fetching data...</h2>
            </div>
        )
    }

    if(errorMsg !== null) {
        return (
            <div>
                <h3>ERROR Fetching Data</h3>
                <p>{errorMsg}</p>
            </div>
        )
    }

    return (
        <div key={`price-data-results-${base}-${target}`}>
            <h2>Price Results for {base} - {target}</h2>
            <h4>
                Change Number of Minutes of data to use<br/>
                <select onChange={onMinutesDataChange} className="form-select" defaultValue={minsOfData}>
                    <option value={0}>0</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={4}>4</option>
                    <option value={5}>5</option>
                    <option value={6}>6</option>
                    <option value={7}>7</option>
                    <option value={8}>8</option>
                    <option value={9}>9</option>
                    <option value={10}>10</option>
                </select>
                <br/>
                Note: 0 = only the latest price
            </h4>
            <h4>
                Change Outlier Remove method<br/>
                Method: <select onChange={onOutlierMethodChange} className="form-select" defaultValue={outlierMethod}>
                <option value={OUT_CHAUVENET}>{OUT_CHAUVENET}</option>
                <option value={OUT_MAD}>{OUT_MAD}</option>
                <option value={OUT_PEIRCE_CRITERION}>{OUT_PEIRCE_CRITERION}</option>
                <option value={OUT_IDQ}>{OUT_IDQ}</option>
                <option value={OUT_NONE}>{OUT_NONE}</option>
            </select>
                {(outlierMethod === OUT_CHAUVENET) &&
                    <>
                        <br/>
                        {OUT_CHAUVENET} dMax Value: <select defaultValue={dMax} onChange={onDMaxChange}>
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                        <option value={4}>4</option>
                    </select>
                    </>
                }
                <br/>
                <label>
                    <input type="checkbox" checked={weightByLiquidity} onChange={onWeightChange}/>
                    &nbsp;Weight by liquidity (deeper pools count more)
                </label>
                <br/>
                Note: go-ooo&apos;s AdHoc currently uses {OUT_CHAUVENET} (dMax 1); the proposed default is {OUT_MAD} + liquidity-weighting.
            </h4>

            <h2 style={{color: "green"}}>
                Price: 1 {base} = {scientificToDecimal(finalPrice)} {target}
            </h2>
            <h5 style={{marginTop: 0}}>
                ↳ {outlierMethod} outlier removal{weightByLiquidity ? " + liquidity-weighted mean" : " + plain mean"}
                &nbsp;· {aggInfo.nUsed} pools used, {aggInfo.nRejected} rejected
            </h5>

            <h3>||| Raw Data |||</h3>

            <h4>Outlier Removal Method: {outlierMethod}
                {(outlierMethod === OUT_CHAUVENET) &&
                    <>
                        &nbsp; (dMax: {dMax})
                    </>
                }

            </h4>

            <h4>DEX pairs Used</h4>

            <div>
                <NoneSortableTable
                    key={`pair_prices_${base}_${target}`}
                    caption=""
                    data={priceTableData}
                    columns={columns}
                />
            </div>

            {statsBefore && <div>
                <h4>Stats before Outliers Removed</h4>
                <NoneSortableTable
                    key={`stats_before_${base}_${target}`}
                    caption=""
                    data={[statsBefore]}
                    columns={statsColumns}
                />
            </div>}

            <h4>{removedPrices.length} Prices removed from calculation using {outlierMethod} method</h4>

            {
                (removedPrices.length > 0) && <>
                    <ul>
                        {removedPrices.map((removed, i) => {
                            return (
                                <li key={`removed-${i}-${removed}`}>
                                    <NumericFormat displayType="text" thousandSeparator="," value={removed}/>
                                </li>
                            )
                        })}
                    </ul>
                </>
            }

            {statsAfter && <div>
                <h4>Stats after Outliers Removed</h4>
                <SortableTable
                    key={`stats_before_${base}_${target}_${Date.now()}`}
                    caption=""
                    data={[statsAfter]}
                    columns={statsColumns}
                    useFilter={false}
                />
            </div>}

        </div>
    )

}

export default PriceData;
