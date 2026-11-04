import React from "react";

import { humaniseSlug } from "../lib/format";

// Canonical display names for known dex slugs; anything unmapped (newly onboarded
// DEXs) falls back to a humanised slug rather than rendering blank.
const dexNames: Record<string, string> = {
    pancakeswap_v2: "Pancakeswap V2",
    bsc_pancakeswap_v3: "Pancakeswap V3",
    "pancakeswap-v3-bsc": "Pancakeswap V3",
    shibaswap: "ShibaSwap",
    sushiswap: "SushiSwap",
    uniswap_v2: "Uniswap V2",
    uniswap_v3: "Uniswap V3",
    quickswap_v3: "Quickswap V3",
    honeyswap: "Honeyswap",
    camelot_v2: "Camelot V2",
    camelot_v3: "Camelot V3",
    aerodrome_slipstream: "Aerodrome Slipstream",
    qomswap_v2: "QomSwap V2",
};

const DexName: React.FC<{ dex: string }> = ({ dex }) => (
    <span>{dexNames[dex] || humaniseSlug(dex)}</span>
);

export default DexName;
