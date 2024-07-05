const {PrismaClient} = require('@prisma/client');
const prisma = new PrismaClient();


const truncateAll = async() => {
    const tablenames = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public'`

    const tables = tablenames
        .map(({ tablename }) => tablename)
        .filter((name) => name !== '_prisma_migrations')
        .map((name) => `"public"."${name}"`)
        .join(', ')

    console.log("Truncating", tables)

    try {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`)
    } catch (error) {
        console.log({ error })
    }

    return "Done"
}

const truncateStaging = async() => {
    console.log("Truncating PairStaging")
    let res = null
    try {
        res = await prisma.$executeRawUnsafe(`TRUNCATE TABLE "public"."PairStaging" CASCADE;`)
    } catch (error) {
        console.log({ error })
    }

    console.log(res)
    return "Done"
}

const deleteFromPairs = async(chain, dex) => {

    const pairsToDel = await prisma.pair.findMany({
        where: {
            chain,
            dex,
        },
    })

    for(let i = 0; i < pairsToDel.length; i += 1) {
        const p = pairsToDel[i]
        console.log("delete", p.id)
        await prisma.duplicatePairs.deleteMany({
            where: {
                OR: [
                    {
                        originalPairId: p.id,
                    },
                    {
                        duplicatePairId: p.id,
                    }
                ],
            },
        })

        await prisma.pair.delete({
            where: {
                id: p.id,
            },
        })
    }

    await prisma.pairStaging.deleteMany({
        where: {
            chain,
            dex,
        },
    })

    return "done"
}

const deleteTokens = async(chain) => {

    const tokensToDel = await prisma.token.findMany({
        where: {
            chain,
        },
    })

    for(let i = 0; i < tokensToDel.length; i += 1) {
        const t = tokensToDel[i]
        console.log("delete", t.id)
        await prisma.duplicateTokenSymbols.deleteMany({
            where: {
                OR: [
                    {
                        originalTokenId: t.id,
                    },
                    {
                        duplicateTokenId: t.id,
                    }
                ],
            },
        })

        await prisma.token.delete({
            where: {
                id: t.id,
            },
        })
    }

    return "Done"
}

const setCreatedAt = async () => {
    const updateTokens = await prisma.token.updateMany({
        where: {
            createdAt: 0,
        },
        data: {
            createdAt: 1719487962,
        },
    })

    const updatePairs = await prisma.pair.updateMany({
        where: {
            createdAt: 0,
        },
        data: {
            createdAt: 1719487963,
        },
    })

}

const run = async () => {
    // await truncateAll()

    // const delPairs = await deleteFromPairs("bsc", "pancakeswap_v2")
    // console.log(delPairs)

    // const delTokens = await deleteTokens("bsc")
    // console.log(delTokens)

    // await setCreatedAt()

    // await truncateStaging()
    return "Done"
}

run().then(console.log)
