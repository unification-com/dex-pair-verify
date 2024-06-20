import React from "react";
import Link from "next/link";

const CoinGeckoCoinLink: React.FC<{ coingeckoId: string }> = ({ coingeckoId }) => {

    if(coingeckoId !== "") {
        return (
            <>
                <Link href={`https://www.coingecko.com/en/coins/${coingeckoId}`}>
                    <a target="_blank">{coingeckoId}</a>
                </Link>
            </>
        )
    }


    return (
        <>Not currently listed</>
    )

}

export default CoinGeckoCoinLink;
