
type DuplicatePairCounter = {
    duplicatePairs: number;
}

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
        coingeckoCoinId: string;
    } | null;
    token1: {
        id: string;
        symbol: string;
        contractAddress: string;
        txCount: number;
        status: number;
        coingeckoCoinId: string;
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
    token0PriceCg: number | string | null;
    token1PriceCg: number | string | null;
    status: number;
    verificationMethod: string;
    verificationComment: string;
    duplicatePairs: any | null
    duplicateCount: number | null;
    token0Id: string;
    token1Id: string;
    createdAt: Date;
    lastChecked: Date;
    _count: DuplicatePairCounter | null;
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
    verificationComment: string;
    duplicatePairs: any | null
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
    duplicatePairs: any | null
}

type DuplicateTokenCounter = {
    duplicateTokenSymbols: number;
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
    lastChecked: Date;
    verificationMethod: string;
    verificationComment: string;
    duplicateCount: number
    pairsToken0: AssociatedPairProps[] | null;
    pairsToken1: AssociatedPairProps[] | null;
    duplicateTokenSymbols: any | null;
    createdAt: Date;
    _count: DuplicateTokenCounter | null;
};

export type ThresholdProps = {
    id: string;
    chain: string;
    dex: string;
    minLiquidityUsd: number;
    minTxCount: number;
}
