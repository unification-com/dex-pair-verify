import React from "react";

import { humaniseSlug } from "../lib/format";

// Canonical display names for known chain slugs; anything unmapped (newly
// onboarded networks) falls back to a humanised slug rather than rendering blank.
const chainNames: Record<string, string> = {
    eth: "Ethereum",
    bsc: "BSC",
    polygon_pos: "Polygon",
    gnosis: "Gnosis (xDai)",
    xdai: "Gnosis (xDai)",
    arbitrum: "Arbitrum",
    base: "Base",
    optimism: "Optimism",
    qom: "QoM",
};

const ChainName: React.FC<{ chain: string }> = ({ chain }) => (
    <span>{chainNames[chain] || humaniseSlug(chain)}</span>
);

export default ChainName;
