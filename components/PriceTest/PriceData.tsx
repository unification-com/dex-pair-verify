import React, {useEffect, useState} from "react";
import SortableTable from "../SortableTable/SortableTable";
import {PairProps} from "../../types/props";
import {Web3} from "web3";
import {removeOutliersChauvenet, calculateMean, getStats, scientificToDecimal} from "../../lib/stats"
import {NumericFormat} from "react-number-format";
const PriceData: React.FC<{
    base: string,
    target: string,
    pairs: PairProps[],
}> = ({ base, target, pairs }) => {

    const [priceTableData, setPriceTableData] = useState([]);
    const [priceData, setPriceData] = useState({
        meanPrice: 0,
        statsBefore: {
            id: "stats-before",
            mean: 0,
            n: 0,
            stdDev: 0,
            sum: 0,
            variance: 0,
        },
        statsAfter: {
            id: "stats-after",
            mean: 0,
            n: 0,
            stdDev: 0,
            sum: 0,
            variance: 0,
        },
        originalPrices: [],
        pricesOutliersRemoved: [],
        removedPrices: [],
    });
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
                    }
                }
                setPriceTableData(pd)
            })
            .catch(error => {
                console.log(error)
            });

        // fetchData();
    }, []);

    useEffect(() => {
        const prices = []
        for(let i = 0; i < priceTableData.length; i += 1) {
            const p = priceTableData[i]
            const price = (target === p.token0Symbol) ? p.token0Price : p.token1Price
            prices.push(parseFloat(price))
        }

        if(prices.length > 1) {
            const statsBefore = getStats(prices)
            const pricesOutliersRemoved = removeOutliersChauvenet(prices, 2)
            const statsAfter = getStats(pricesOutliersRemoved)
            const meanPrice = calculateMean(pricesOutliersRemoved)

            const removedPrices =
                prices.filter((element) => !pricesOutliersRemoved.includes(element));

            statsBefore.id = "stats-before"
            statsAfter.id = "stats-after"

            const d = {
                meanPrice,
                statsBefore,
                statsAfter,
                originalPrices: prices,
                pricesOutliersRemoved,
                removedPrices,
            }

            // @ts-ignore
            setPriceData(d)
        } else {
            const d = priceData
            d.meanPrice = prices[0]
            setPriceData(d)
        }
    }, [priceTableData]);

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
        {label: "Number of Elements", accessor: "n", sortable: true, cellType: "number_raw"},
        {label: "Sum", accessor: "sum", sortable: true, cellType: "number_raw"},
        {label: "Mean", accessor: "mean", sortable: true, cellType: "number_raw"},
        {label: "Std Deviation", accessor: "stdDev", sortable: true, cellType: "number_raw"},
        {label: "Variance", accessor: "variance", sortable: true, cellType: "number_raw"},
    ]

    return (
        <div>
            <h2>Price Results for {base} - {target}</h2>

            <h3>Mean Price: 1 {base} = {priceData.meanPrice} {target}</h3>

            <h3>||| Raw Data |||</h3>

            <h4>DEX pairs Used</h4>

            <div>
                <SortableTable
                    key={`pair_prices_${base}_${target}_${Date.now()}`}
                    caption=""
                    data={priceTableData}
                    columns={columns}
                    useFilter={false}
                />
            </div>

            {priceData.statsBefore && <div>
                <h4>Stats before Outliers Removed</h4>
                <SortableTable
                    key={`stats_before_${base}_${target}_${Date.now()}`}
                    caption=""
                    data={[priceData.statsBefore]}
                    columns={statsColumns}
                    useFilter={false}
                />
            </div>}

            {
                (priceData.removedPrices.length > 0) && <>
                    <h4>Prices removed from calculation</h4>

                    <ul>
                        {priceData.removedPrices.map((removed) => {
                            return (
                                <li>
                                    <NumericFormat displayType="text" thousandSeparator="," value={removed}/>
                                </li>
                            )
                        })}
                    </ul>
                </>
            }

            {priceData.statsAfter && <div>
                <h4>Stats after Outliers Removed</h4>
                <SortableTable
                    key={`stats_before_${base}_${target}_${Date.now()}`}
                    caption=""
                    data={[priceData.statsAfter]}
                    columns={statsColumns}
                    useFilter={false}
                />
            </div>}

            <h1>FINAL MEAN PRICE<br />1 {base} = {scientificToDecimal(priceData.meanPrice)} {target}</h1>
        </div>
    )

}

export default PriceData;
