import React from "react";

const DexName: React.FC<{ dex: string }> = ({ dex }) => {

    const dexNames = {
        pancakeswap_v2: "Pancakeswap V2",
        shibaswap: "ShibaSwap",
        sushiswap: "SushiSwap",
        uniswap_v2: "Uniswap V2",
        uniswap_v3: "Uniswap V3",
        quickswap_v3: "Quickswap V3",
        honeyswap: "Honeyswap",
    }

    const dexName = dexNames[dex]

    return (
        <>
            <span>{dexName}</span>
        </>
    )

}

export default DexName;
