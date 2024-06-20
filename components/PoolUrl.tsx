import React from "react";
import Link from "next/link";

const PoolUrl: React.FC<{ chain: string, dex: string, contractAddress: string }> = ({ chain, dex, contractAddress }) => {

    const poolUrls = {
        bsc_pancakeswap_v2: "https://pancakeswap.finance/info/v2/pairs/",
        eth_shibaswap: "https://analytics.shibaswap.com/pairs/",
        eth_sushiswap: "https://www.sushi.com/pool/1%3A",
        eth_uniswap_v2: "https://app.uniswap.org/explore/pools/ethereum/",
        eth_uniswap_v3: "https://app.uniswap.org/explore/pools/ethereum/",
        polygon_pos_quickswap_v3: "https://quickswap.exchange/#/analytics/v3/pair/",
        gnosis_honeyswap: "https://info.honeyswap.org/#/pair/",
        xdai_honeyswap: "https://info.honeyswap.org/#/pair/",
    }

    const pool = poolUrls[`${chain}_${dex}`]

    return (
        <>
            <Link href={`${pool}${contractAddress}`}>
                <a target="_blank">{contractAddress}</a>
            </Link>
        </>
    )

}

export default PoolUrl;
