import React from "react";
import {PairProps} from "../../types/props";
import Status from "../Status";
import SortableTable from "../SortableTable/SortableTable";
import PriceData from "./PriceData";

const PriceTest: React.FC<{
    base: string,
    target: string,
    usablePairs: PairProps[];
    ignoredPairs: PairProps[];
    minReserveUsd: number;
}> = ({ base, target, usablePairs, ignoredPairs, minReserveUsd }) => {

    const columns = [
        { label: "Chain", accessor: "chain", sortable: true, sortbyOrder: "asc", cellType: "display" },
        { label: "Dex", accessor: "dex", sortable: true, sortbyOrder: "asc", cellType: "display" },
        { label: "Pair", accessor: "pair", sortable: true, sortbyOrder: "asc", cellType: "display" },
        { label: "Tx Count", accessor: "txCount", sortable: true, cellType: "number" },
        { label: "Market Cap USD", accessor: "marketCapUsd", sortable: true, cellType: "usd" },
        { label: "Reserve USD", accessor: "reserveUsd", sortable: true, cellType: "usd" },
        { label: "# Buys (24h)", accessor: "buys24h", sortable: true, cellType: "number" },
        { label: "# Sells (24h)", accessor: "sells24h", sortable: true, cellType: "number" },
        { label: "Edit", accessor: "id", sortable: false, cellType: "edit_link", meta: {url: "/p/__ID__", text: "View/Edit"} },
    ];

    return (
        <div key={`pair_price_test_${base}-${target}`}>
            <h1>Pair</h1>
            <h2>Test prices for {base} to {target}</h2>

            <h3>Only <Status status={1} method={""} /> pairs are used, with a USD reserve &gt;= ${minReserveUsd}</h3>
            {
                (usablePairs.length) > 0 &&
                <>
                    <h4>Usable pairs from all DEXs</h4>
                    <SortableTable
                        key={`test_pair_usable_list_${base}-${target}`}
                        caption=""
                        data={usablePairs}
                        columns={columns}
                        useFilter={false}
                    />
                </>
            }

            {
                (ignoredPairs.length) > 0 &&
                <>
                    <h4>Ignored pairs</h4>
                    <SortableTable
                        key={`test_pair_ignore_list_${base}-${target}`}
                        caption=""
                        data={ignoredPairs}
                        columns={columns}
                        useFilter={false}
                    />
                </>
            }

            <PriceData base={base} target={target} pairs={usablePairs} />

        </div>
    )

}

export default PriceTest;
