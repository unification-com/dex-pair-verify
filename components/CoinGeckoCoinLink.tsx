import React from "react";

const CoinGeckoCoinLink: React.FC<{ coingeckoId: string }> = ({ coingeckoId }) => {

    if(coingeckoId !== "") {
        return (
            <>
                <a href={`https://www.coingecko.com/en/coins/${encodeURIComponent(coingeckoId)}`} target="_blank" rel="noopener noreferrer">
                    {coingeckoId}
                </a>
            </>
        )
    }


    return (
        <>Not currently listed</>
    )

}

export default CoinGeckoCoinLink;
