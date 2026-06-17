import Link from "next/link";
import React from "react";

import { explorerUrl } from "../lib/externalLinks";

// Renders a token/pool identifier as a link to its chain explorer (EVM block explorer, or a Cosmos
// explorer/app — Mintscan / the chain's app). symbol is optional and only used to resolve an Osmosis
// token's app asset page (which is keyed by symbol, not denom). When no reliable link exists (e.g. a
// Cosmos ibc/native denom), the identifier is shown as plain text rather than a broken link.
const ExplorerUrl: React.FC<{ chain: string, contractAddress: string, linkType: string, symbol?: string | null }> = ({ chain, contractAddress, linkType, symbol }) => {

    const url = explorerUrl(chain, linkType, contractAddress, symbol);

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
