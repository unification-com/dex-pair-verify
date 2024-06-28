import React, {useEffect, useState} from "react";
import SortableTable from "../SortableTable/SortableTable";
import {PairProps} from "../../types/props";
import {Web3} from "web3";
import {
    removeOutliersChauvenet,
    removeOutliersIQD,
    removeOutliersPeirceCriterion,
    calculateMean,
    getStats,
    scientificToDecimal
} from "../../lib/stats"
import {NumericFormat} from "react-number-format";
import NoneSortableTable from "../SortableTable/NoneSortableTable";
const PriceData: React.FC<{
    base: string,
    target: string,
    pairs: PairProps[],
}> = ({ base, target, pairs }) => {

    const OUT_PEIRCE_CRITERION = "PeirceCriterion"
    const OUT_NONE = "None"
    const OUT_IDQ = "IDQ"
    const OUT_CHAUVENET = "Chauvenet"

    const [isFetching, setIsFetching] = useState(true)
    const [errorMsg, setErrorMsg] = useState("")
    const [priceTableData, setPriceTableData] = useState([]);
    const [originalPrices, setOriginalPrices] = useState([])
    const [pricesOutliersRemoved, setPricesOutliersRemoved] = useState([])
    const [removedPrices, setRemovedPrices] = useState([])
    const [meanPrice, setMeanPrice] = useState(0)
    const [statsBefore, setStatsBefore] = useState(
        {
            id: "stats-before",
            mean: 0,
            n: 0,
            stdDev: 0,
            sum: 0,
            variance: 0,
        }
    )
    const [statsAfter, setStatsAfter] = useState(
        {
            id: "stats-after",
            mean: 0,
            n: 0,
            stdDev: 0,
            sum: 0,
            variance: 0,
        }
    )
    const [outlierMethod, setOutlierMethod] = useState(OUT_CHAUVENET)
    const [dMax, setDMax] = useState(2)

    const contactList = {}

    for(let i = 0; i < pairs.length; i += 1) {
        const p = pairs[i]

        if(contactList[p.chain] === undefined) {
            contactList[p.chain] = {}
        }

        if(contactList[p.chain][p.dex] === undefined) {
            contactList[p.chain][p.dex] = []
        }
        contactList[p.chain][p.dex].push(p.contractAddress)
    }

    useEffect(() => {
        console.log("fetch")
        const endpoints = []
        for (const chain in contactList) {
            // Get the indexed item by the key:
            const chainDexs = contactList[chain];
            for (const dex in chainDexs) {
                const contracts = chainDexs[dex]
                const url = `/api/getprices?chain=${chain}&dex=${dex}&addresses=${contracts.join(",")}`
                endpoints.push(url)
            }
        }

        function getPairInfo(c, d, cAddr) {
            let pId = null
            let t0Id = null
            let t1Id = null
            let pairName = null

            for(let i = 0; i < pairs.length; i += 1) {
                const p = pairs[i]
                if(p.chain === c && p.dex === d && Web3.utils.toChecksumAddress(p.contractAddress) === Web3.utils.toChecksumAddress(cAddr)) {
                    pId = p.id
                    t0Id = p.token0Id
                    t1Id = p.token1Id
                    pairName = p.pair
                    break
                }
            }

            return {pId, t0Id, t1Id, pairName}
        }

        const fetchPromises = endpoints.map(endpoint => fetch(endpoint));

        Promise.all(fetchPromises)
            .then(responses => Promise.all(responses.map(response => response.json())))
            .then(data => {
                // Merge and process the data
                const pd = []
                for(let i = 0; i < data.length; i += 1) {
                    const d = data[i]
                    if(d.success) {
                        for(let j = 0; j < d.prices.length; j += 1) {

                            const {pId, t0Id, t1Id, pairName} = getPairInfo(d.prices[j].chain, d.prices[j].dex, d.prices[j].pairContractAddress)
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
                                }
                            )
                        }
                    } else {
                        setErrorMsg(d.error)
                        setIsFetching(false)
                    }
                }
                setPriceTableData(pd)
            })
            .catch(e => {
                console.log(e)
                setErrorMsg(e.message)
                setIsFetching(false)
            });
    }, [pairs]);

    useEffect(() => {
        const prices = []
        for(let i = 0; i < priceTableData.length; i += 1) {
            const p = priceTableData[i]
            const price = (target === p.token0Symbol) ? p.token0Price : p.token1Price
            prices.push(parseFloat(price))
        }

        setOriginalPrices(prices)
        setIsFetching(false)
    }, [priceTableData]);

    useEffect(() => {
        function processMean() {
            let pricesOutliersRemoved = []
            if(originalPrices.length > 1) {
                const statsBefore = getStats(originalPrices)

                switch(outlierMethod) {
                    case OUT_CHAUVENET:
                        pricesOutliersRemoved = removeOutliersChauvenet(originalPrices, dMax)
                        break
                    case OUT_IDQ:
                        pricesOutliersRemoved = removeOutliersIQD(originalPrices)
                        break
                    case OUT_PEIRCE_CRITERION:
                        pricesOutliersRemoved = removeOutliersPeirceCriterion(originalPrices)
                        break
                    case OUT_NONE:
                    default:
                        pricesOutliersRemoved = originalPrices
                        break
                }

                const statsAfter = getStats(pricesOutliersRemoved)
                const meanPrice = calculateMean(pricesOutliersRemoved)

                const removedPrices =
                    originalPrices.filter((element) => !pricesOutliersRemoved.includes(element));

                statsBefore.id = "stats-before"
                statsAfter.id = "stats-after"

                setMeanPrice(meanPrice)
                setPricesOutliersRemoved(pricesOutliersRemoved)
                setRemovedPrices(removedPrices)
                // @ts-ignore
                setStatsBefore(statsBefore)
                // @ts-ignore
                setStatsAfter(statsAfter)
            } else {
                setMeanPrice(originalPrices[0])
            }
        }

        processMean()
    }, [originalPrices, outlierMethod, dMax]);

    const onOutlierMethodChange = (event) => {
        const value = event.target.value;
        setOutlierMethod(value);
    };

    const onDMaxChange = (event) => {
        const value = event.target.value;
        setDMax(parseInt(value))
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
            <h3>Loading...</h3>
        )
    }

    return (
        <div key={`price-data-results-${base}-${target}`}>
            <h2>Price Results for {base} - {target}</h2>

            {
                errorMsg && <>
                    <h3>ERROR: {errorMsg}</h3>
                </>
            }

            <h4>
                Change Outlier Remove method<br/>
                Method: <select onChange={onOutlierMethodChange} className="form-select" defaultValue={outlierMethod}>
                <option value={OUT_CHAUVENET}>{OUT_CHAUVENET}</option>
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
                <br />
                Note: OoO AdHoc currently only uses the {OUT_CHAUVENET}, with dMax = 1
            </h4>

            <h3>Mean Price: 1 {base} = {meanPrice} {target}</h3>

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
                        {removedPrices.map((removed) => {
                            return (
                                <li>
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

            <h1>FINAL MEAN PRICE<br/>1 {base} = {scientificToDecimal(meanPrice)} {target}</h1>
        </div>
    )

}

export default PriceData;
