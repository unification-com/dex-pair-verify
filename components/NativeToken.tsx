import React from "react";

const NativeToken: React.FC<{ chain: string }> = ({ chain}) => {

    const nativeTokens = {
        eth: "ETH",
        bsc: "BNB",
        polygon_pos: "MATIC",
        gnosis: "xDAI",
        xdai: "xDAI",
    }

    const token = nativeTokens[chain]

    return (
        <>
            <span>{token}</span>
        </>
    )

}

export default NativeToken;
