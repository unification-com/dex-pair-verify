import React from "react";
import Link from "next/link";

const ExplorerUrl: React.FC<{ chain: string, contractAddress: string, linkType: string }> = ({ chain, contractAddress, linkType }) => {

    const explorerUrls = {
        eth: "https://etherscan.io",
        bsc: "https://bscscan.com",
        polygon_pos: "https://polygonscan.com",
        gnosis: "https://gnosis.blockscout.com",
        xdai: "https://gnosis.blockscout.com",
    }

    const explorer = explorerUrls[chain]

    return (
        <>
            <Link href={`${explorer}/${linkType}/${contractAddress}`}>
                <a target="_blank">{contractAddress}</a>
            </Link>
        </>
    )

}

export default ExplorerUrl;
