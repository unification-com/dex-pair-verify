const {PrismaClient} = require('@prisma/client');
const prisma = new PrismaClient();
const getOrAddStagingPair = async (chain, dex, contractAddress, token0Address, token1Address) => {
    let created = false
    let pairDb = await prisma.pairStaging.findFirst({
        where: {
            contractAddress: {
                equals: contractAddress,
                mode: 'insensitive'
            },
            chain,
            dex,
        },
    })

    if (pairDb === null) {
        pairDb = await prisma.pairStaging.create({
            data: {
                chain,
                dex,
                contractAddress,
                token0Address,
                token1Address,
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
            contractAddress: {
                equals: contractAddress,
                mode: 'insensitive'
            },
        },
    })

    if (token === null) {
        token = await prisma.token.create({
            data: {
                chain,
                contractAddress,
                name,
                symbol,
                txCount: parseInt(txCount),
                status,
                verificationMethod,
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
            contractAddress: {
                equals: contractAddress,
                mode: 'insensitive'
            },
            chain,
            dex,
        },
    })

    if (pairDb === null) {
        pairDb = await prisma.pair.create({
            data: {
                chain,
                dex,
                contractAddress,
                reserveUsd: parseFloat(reserveUsd),
                volumeUsd: parseFloat(volumeUsd),
                txCount: parseInt(txCount),
                reserveNativeCurrency: parseFloat(reserveNativeCurrency),
                reserve0: parseFloat(reserve0),
                reserve1: parseFloat(reserve1),
                status,
                pair,
                verificationMethod,
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
        addresses.push(stagingPairs[j].contractAddress)
    }

    return addresses
}

const getStagingPair = async (chain, dex, contractAddress, token0Address, token1Address) => {
    return prisma.pairStaging.findFirst({
        where: {
            chain,
            dex,
            contractAddress: {
                equals: contractAddress,
                mode: 'insensitive'
            },
            token0Address: {
                equals: token0Address,
                mode: 'insensitive'
            },
            token1Address: {
                equals: token1Address,
                mode: 'insensitive'
            },
        },
    })
}

module.exports = {
    getOrAddStagingPair,
    getOrAddToken,
    getOrAddPair,
    getQueryContractAddresses,
    getStagingPair,
}
