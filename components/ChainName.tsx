import React from "react";

const ChainName: React.FC<{ chain: string }> = ({ chain }) => {

    const chainNames = {
        eth: "Ethereum",
        bsc: "BSC",
        polygon_pos: "Polygon",
        gnosis: "Gnosis (xDai)",
        xdai: "Gnosis (xDai)"
    }

    const chainName = chainNames[chain]

    return (
        <>
            <span>{chainName}</span>
        </>
    )

}

export default ChainName;
