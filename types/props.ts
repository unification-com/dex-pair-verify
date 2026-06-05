import {TokenPairStatus} from "./types";

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
        status: TokenPairStatus;
        coingeckoCoinId: string;
    } | null;
    token1: {
        id: string;
        symbol: string;
        contractAddress: string;
        txCount: number;
        status: TokenPairStatus;
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
    status: TokenPairStatus;
    verificationMethod: string;
    verificationComment: string;
    confidence: number | null;
    verdictEvidence: Record<string, number | string | boolean> | null;
    duplicatePairs: { duplicatePair: PairPropsNoToken }[] | null
    duplicateCount: number | null;
    reviewTier: string | null;
    reviewTierLabel: string;
    token0Id: string;
    token1Id: string;
    createdAt: number;
    lastChecked: number;
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
    status: TokenPairStatus;
    verificationMethod: string;
    verificationComment: string;
    duplicatePairs: { duplicatePair: PairPropsNoToken }[] | null
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
    confidence: number | null;
    status: TokenPairStatus;
    duplicatePairs: { duplicatePair: PairPropsNoToken }[] | null
}

// One identity-source verdict (lib/identity), stored on Token.identityData.
export type IdentitySource = {
    source: string;
    category: string;
    confirmed: boolean;
    detail: string;
};

type DuplicateTokenCounter = {
    duplicateTokenSymbols: number;
}

export type TokenProps = {
    id: string;
    chain: string;
    contractAddress: string;
    symbol: string;
    name: string;
    status: TokenPairStatus;
    txCount: number;
    coingeckoCoinId: string;
    totalSupply: number;
    volume24hUsd: number
    marketCapUsd: number
    decimals: number
    lastChecked: number;
    verificationMethod: string;
    verificationComment: string;
    isScamFlagged: boolean;
    scamReason: string;
    scamCheckedAt: number;
    goPlusData: Record<string, unknown> | null;
    identityConfirmed: boolean;
    identityData: IdentitySource[] | null;
    identityCheckedAt: number;
    canonicalCheckedAt: number;
    deploymentTimestamp: number | null;
    duplicateCount: number
    pairsToken0: AssociatedPairProps[] | null;
    pairsToken1: AssociatedPairProps[] | null;
    duplicateTokenSymbols: { duplicateToken: TokenProps }[] | null;
    createdAt: number;
    _count: DuplicateTokenCounter | null;
};

export type ThresholdProps = {
    id: string;
    chain: string;
    dex: string;
    minLiquidityUsd: number;
    minTxCount: number;
}
