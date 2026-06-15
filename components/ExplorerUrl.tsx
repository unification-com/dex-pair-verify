import Link from "next/link";
import React from "react";

import { blockExplorerUrl } from "../lib/externalLinks";

const ExplorerUrl: React.FC<{ chain: string, contractAddress: string, linkType: string }> = ({ chain, contractAddress, linkType }) => {

    const url = blockExplorerUrl(chain, linkType, contractAddress);

    // No block explorer for this chain (e.g. a Cosmos IBC/factory denom, which isn't a contract
    // address) — show the identifier as plain text rather than a broken `undefined/...` link.
    if (!url) {
        return <span>{contractAddress}</span>;
    }

    return (
        <Link href={url}>
            <a target="_blank">{contractAddress}</a>
        </Link>
    )

}

export default ExplorerUrl;
