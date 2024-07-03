const {PrismaClient} = require('@prisma/client');
const Web3 = require("web3");
const prisma = new PrismaClient();
const getOrAddStagingPair = async (chain, dex, contractAddress, token0Address, token1Address) => {
    let created = false
    let pairDb = await prisma.pairStaging.findFirst({
        where: {
            contractAddress: Web3.utils.toChecksumAddress(contractAddress),
            chain,
            dex,
        },
    })

    if (pairDb === null) {
        pairDb = await prisma.pairStaging.create({
            data: {
                chain,
                dex,
                contractAddress: Web3.utils.toChecksumAddress(contractAddress),
                token0Address: Web3.utils.toChecksumAddress(token0Address),
                token1Address: Web3.utils.toChecksumAddress(token1Address),
            },
        })
        created = true
    }

    return [pairDb, created]
}

const getOrAddToken = async (chain, contractAddress, name, symbol, txCount, status, verificationMethod) => {
    let created = false
    let token = await prisma.token.findFirst({
        where: {
            chain,
            contractAddress: Web3.utils.toChecksumAddress(contractAddress),
        },
    })

    if (token === null) {
        token = await prisma.token.create({
            data: {
                chain,
                contractAddress: Web3.utils.toChecksumAddress(contractAddress),
                name,
                symbol,
                txCount: parseInt(txCount),
                status,
                verificationMethod,
                coingeckoCoinId: "",
                totalSupply: 0,
                volume24hUsd: 0,
                marketCapUsd: 0,
                lastChecked: Date.now(),
                decimals: 0,
                verificationComment: "",
                createdAt: Date.now(),
            },
        })
        created = true
    }

    return [token, created]
}

const getOrAddPair = async (
    chain,
    dex,
    contractAddress,
    pair,
    t0Id,
    t1Id,
    reserveUsd,
    reserveNativeCurrency,
    reserve0,
    reserve1,
    volumeUsd,
    txCount,
    status,
    verificationMethod
) => {
    let created = false
    let pairDb = await prisma.pair.findFirst({
        where: {
            contractAddress: Web3.utils.toChecksumAddress(contractAddress),
            chain,
            dex,
        },
    })

    if (pairDb === null) {
        pairDb = await prisma.pair.create({
            data: {
                chain,
                dex,
                contractAddress: Web3.utils.toChecksumAddress(contractAddress),
                reserveUsd: parseFloat(reserveUsd),
                volumeUsd: parseFloat(volumeUsd),
                txCount: parseInt(txCount),
                reserveNativeCurrency: parseFloat(reserveNativeCurrency),
                reserve0: parseFloat(reserve0),
                reserve1: parseFloat(reserve1),
                status,
                pair,
                verificationMethod,
                marketCapUsd: 0,
                priceChangePercentage24h: 0,
                buys24h: 0,
                sells24h: 0,
                buyers24h: 0,
                sellers24h: 0,
                volumeUsd24h: 0,
                lastChecked: Date.now(),
                token0PriceCg: 0,
                token0PriceDex: 0,
                token1PriceCg: 0,
                token1PriceDex: 0,
                verificationComment: "",
                createdAt: Date.now(),
                token0: {
                    connect: {
                        id: t0Id,
                    }
                },
                token1: {
                    connect: {
                        id: t1Id,
                    }
                }
            },
        })
        created = true
    }

    return [pairDb, created]
}

const getQueryContractAddresses = async (chain, dex) => {
    const addresses = []

    const stagingPairs = await prisma.pairStaging.findMany({
        where: {
            chain,
            dex,
        },
    })

    for (let j = 0; j < stagingPairs.length; j += 1) {
        addresses.push(Web3.utils.toChecksumAddress(stagingPairs[j].contractAddress))
    }

    return addresses
}

const getStagingPair = async (chain, dex, contractAddress, token0Address, token1Address) => {
    return prisma.pairStaging.findFirst({
        where: {
            chain,
            dex,
            contractAddress: Web3.utils.toChecksumAddress(contractAddress),
            token0Address: Web3.utils.toChecksumAddress(token0Address),
            token1Address: Web3.utils.toChecksumAddress(token1Address),
        },
    })
}

const getTokensToFetchFromCoingecko = async (chain) => {
    let d = new Date()
    d.setDate(d.getDate() - 1)
    return prisma.token.findMany({
        where: {
            chain,
            lastChecked: {
                lt: d,
            }
        },
    })
}

const getAllTokenSymbolsForChain = async (chain) => {
    return prisma.token.findMany({
        select: {
          id: true,
          symbol: true,
          chain: true,
        },
        where: {
            chain,
        },
    })
}

const getOrAddDuplicateTokenSymbol = async (chain, originalTokenId, duplicateTokenId) => {
    let created = false
    let duplicate = await prisma.duplicateTokenSymbols.findFirst({
        where: {
            chain,
            originalTokenId,
            duplicateTokenId,
        },
    })

    if (duplicate === null) {
        duplicate = await prisma.duplicateTokenSymbols.create({
            data: {
                chain,
                originalTokenId,
                duplicateTokenId,
            },
        })
        created = true
    }

    return [duplicate, created]
}

const getPairsToFetchFromCoingecko = async (chain, dex) => {
    let d = new Date()
    d.setDate(d.getDate() - 1)
    return prisma.pair.findMany({
        where: {
            chain,
            dex,
            lastChecked: {
                lt: d,
            }
        },
        include: {
            token0: {
                select: { symbol: true, id: true, contractAddress: true, status: true, txCount: true },
            },
            token1: {
                select: { symbol: true, id: true, contractAddress: true, status: true, txCount: true },
            },
        },
    })
}

const updateTokenWithCoingeckoData = async (tId, coingeckoCoinId, totalSupply, decimals, volume24hUsd, marketCapUsd) => {

    return await prisma.token.update({
        where: {
            id: tId,
        },
        data: {
            coingeckoCoinId,
            totalSupply: parseFloat(totalSupply),
            volume24hUsd: parseFloat(volume24hUsd),
            marketCapUsd: parseFloat(marketCapUsd),
            decimals: parseInt(decimals),
            lastChecked: Date.now(),
        },
    })
}

const getAllPairsForChainDex = async (chain, dex) => {
    return prisma.pair.findMany({
        where: {
            chain,
            dex,
        },
        include: {
            token0: {
                select: {symbol: true},
            },
            token1: {
                select: {symbol: true},
            },
        }
    })
}

const getOrAddDuplicatePair = async (chain, dex, originalPairId, duplicatePairId) => {
    let created = false
    let duplicate = await prisma.duplicatePairs.findFirst({
        where: {
            chain,
            dex,
            originalPairId,
            duplicatePairId,
        },
    })

    if (duplicate === null) {
        duplicate = await prisma.duplicatePairs.create({
            data: {
                chain,
                dex,
                originalPairId,
                duplicatePairId,
            },
        })
        created = true
    }

    return [duplicate, created]
}


const updatePairWithCoingeckoData = async (
    pId,
    marketCapUsd,
    priceChangePercentage24h,
    buys24h,
    sells24h,
    buyers24h,
    sellers24h,
    volumeUsd24h,
    token0PriceCg,
    token1PriceCg,
    ) => {

    return await prisma.pair.update({
        where: {
            id: pId,
        },
        data: {
            marketCapUsd: parseFloat(marketCapUsd),
            priceChangePercentage24h: parseFloat(priceChangePercentage24h),
            buys24h: parseInt(buys24h),
            sells24h: parseInt(sells24h),
            buyers24h: parseInt(buyers24h),
            sellers24h: parseInt(sellers24h),
            volumeUsd24h: parseFloat(volumeUsd24h),
            token0PriceCg: (token0PriceCg === null) ? 0 : parseFloat(token0PriceCg),
            token1PriceCg: (token1PriceCg === null) ? 0 : parseFloat(token1PriceCg),
            lastChecked: Date.now(),
        },
    })
}

module.exports = {
    getOrAddStagingPair,
    getOrAddToken,
    getOrAddPair,
    getQueryContractAddresses,
    getStagingPair,
    getTokensToFetchFromCoingecko,
    updateTokenWithCoingeckoData,
    getPairsToFetchFromCoingecko,
    updatePairWithCoingeckoData,
    getAllTokenSymbolsForChain,
    getOrAddDuplicateTokenSymbol,
    getAllPairsForChainDex,
    getOrAddDuplicatePair,
}
