//https://www.geckoterminal.com/eth/pools/0x06cd6245156c3608ae67d690c125e86a8bc6a88c?utm_source=coingecko&utm_medium=referral&utm_campaign=livechart

import Link from "next/link";
import React from "react";

const CoinGeckoPoolLink: React.FC<{ chain: string, contractAddress: string }> = ({ chain, contractAddress }) => {

    return (
        <>
            <Link href={`https://www.geckoterminal.com/${encodeURIComponent(chain)}/pools/${encodeURIComponent(contractAddress)}`}>
                <a target="_blank">CoinGecko Chart</a>
            </Link>
        </>
    )

}

export default CoinGeckoPoolLink;
