
export type PairProps = {
    id: string;
    chain: string;
    dex: string;
    contractAddress: string;
    pair: string;
    token0: {
        id: string;
        symbol: string;
        contractAddress: string;
        txCount: number;
        status: number;
    } | null;
    token1: {
        id: string;
        symbol: string;
        contractAddress: string;
        txCount: number;
        status: number;
    } | null;
    reserveUsd: number;
    reserve0: number;
    reserve1: number;
    reserveNativeCurrency: number;
    volumeUsd: number;
    txCount: number;
    marketCapUsd: number,
    priceChangePercentage24h: number,
    buys24h: number,
    sells24h: number,
    buyers24h: number,
    sellers24h: number,
    volumeUsd24h: number,
    status: number;
    verificationMethod: string;
};

export type PairPropsNoToken = {
    id: string;
    chain: string;
    dex: string;
    contractAddress: string;
    pair: string;
    reserveUsd: number;
    reserve0: number;
    reserve1: number;
    reserveNativeCurrency: number;
    volumeUsd: number;
    txCount: number;
    marketCapUsd: number,
    priceChangePercentage24h: number,
    buys24h: number,
    sells24h: number,
    buyers24h: number,
    sellers24h: number,
    volumeUsd24h: number,
    status: number;
    verificationMethod: string;
};

export type AssociatedPairProps = {
    id: string;
    pair: string;
    contractAddress: string;
    reserveUsd: number;
    reserve0: number;
    reserve1: number;
    reserveNativeCurrency: number;
    volumeUsd: number;
    txCount: number;
    marketCapUsd: number,
    priceChangePercentage24h: number,
    buys24h: number,
    sells24h: number,
    buyers24h: number,
    sellers24h: number,
    volumeUsd24h: number,
    status: number;
}

export type TokenProps = {
    id: string;
    chain: string;
    contractAddress: string;
    symbol: string;
    name: string;
    status: number;
    txCount: number;
    coingeckoCoinId: string;
    totalSupply: number;
    volume24hUsd: number
    marketCapUsd: number
    decimals: number
    lastChecked: number;
    verificationMethod: string;
    pairsToken0: AssociatedPairProps[] | null;
    pairsToken1: AssociatedPairProps[] | null;
};
