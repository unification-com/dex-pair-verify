import React from "react";

const NativeToken: React.FC<{ chain: string }> = ({ chain}) => {

    const nativeTokens = {
        eth: "ETH",
        bsc: "BNB",
        polygon_pos: "POL",
        gnosis: "xDAI",
        xdai: "xDAI",
        arbitrum: "ETH",
        base: "ETH",
        optimism: "ETH",
        osmosis: "OSMO",
    }

    const token = nativeTokens[chain] ?? chain

    return (
        <>
            <span>{token}</span>
        </>
    )

}

export default NativeToken;
