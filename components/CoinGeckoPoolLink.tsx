//https://www.geckoterminal.com/eth/pools/0x06cd6245156c3608ae67d690c125e86a8bc6a88c?utm_source=coingecko&utm_medium=referral&utm_campaign=livechart

import React from "react";

const CoinGeckoPoolLink: React.FC<{ chain: string, contractAddress: string }> = ({ chain, contractAddress }) => {

    return (
        <>
            <a href={`https://www.geckoterminal.com/${encodeURIComponent(chain)}/pools/${encodeURIComponent(contractAddress)}`} target="_blank" rel="noopener noreferrer">
                CoinGecko Chart
            </a>
        </>
    )

}

export default CoinGeckoPoolLink;
