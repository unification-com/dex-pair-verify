import React, {useState} from "react";
import {PairProps} from "../../types/props";
import PriceData from "./PriceData";
import Link from "next/link";
import NoneSortableTable from "../SortableTable/NoneSortableTable";
import {NumericFormat} from "react-number-format";

const PriceTest: React.FC<{
    base: string,
    target: string,
    usablePairs: PairProps[],
    ignoredPairs: PairProps[],
}> = ({ base, target, usablePairs, ignoredPairs }) => {

    const [usable, setUsable] = useState(usablePairs)
    const [ignored, setIgnored] = useState(ignoredPairs)

    React.useEffect(() => {
        setUsable(usablePairs)
        setIgnored(ignoredPairs)
    }, [usablePairs, ignoredPairs]);

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
            <h2>Test prices for {base} to {target} &nbsp;
                (Try &nbsp;
                <Link
                    href={`/p/test/${target}/${base}`}>
                    <a>{target}-{base}</a>
                </Link>
                )</h2>

            {
                (usable.length) > 0 &&
                <>
                    <h4><span style={{color: "green"}}>Usable</span> pairs from all DEXs</h4>
                    <NoneSortableTable
                        key={`test_pair_usable_list_${base}-${target}`}
                        caption=""
                        data={usable}
                        columns={columns}
                    />
                </>
            }

            {
                (ignored.length) > 0 &&
                <>
                    <h4><span style={{color: "red"}}>Ignored</span> pairs with Reserve USD and Tx Count below
                        thresholds</h4>
                    <NoneSortableTable
                        key={`test_pair_ignore_list_${base}-${target}`}
                        caption=""
                        data={ignored}
                        columns={columns}
                    />
                </>
            }

            <PriceData
                key={`price-data-${base}-${target}`}
                base={base}
                target={target}
                pairs={usable}
            />

        </div>
    )

}

export default PriceTest;
