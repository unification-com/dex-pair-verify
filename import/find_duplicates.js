const {
    getAllTokenSymbolsForChain,
    getOrAddDuplicateTokenSymbol,
    getAllPairsForChainDex,
    getOrAddDuplicatePair,
} = require("./db")
const {dataSources} = require("../lib/sources")

const processTokensForChain = async(chain) => {
    console.log(chain)
    const tokens = await getAllTokenSymbolsForChain(chain)
    let duplicateCount = 0

    for(let i = 0; i < tokens.length; i += 1) {
        const original = tokens[i]
        for(let j = 0; j < tokens.length; j += 1) {
            const potentialDuplicate = tokens[j]

            if(original.id === potentialDuplicate.id) {
                continue
            }

            if(original.symbol === potentialDuplicate.symbol) {
                const [duplicate, created] = await getOrAddDuplicateTokenSymbol(chain, original.id, potentialDuplicate.id)
                if(created) {
                    duplicateCount += 1
                }
            }
        }
    }

    return duplicateCount
}

const processPairsForChain = async(chain, dex) => {
    console.log(chain, dex)
    let duplicateCount = 0

    const pairs = await getAllPairsForChainDex(chain, dex)

    for(let i = 0; i < pairs.length; i += 1) {
        const original = pairs[i]
        const pairCheck0 = `${original.token0.symbol}-${original.token1.symbol}`
        const pairCheck1 = `${original.token1.symbol}-${original.token0.symbol}`

        for(let j = 0; j < pairs.length; j += 1) {
            const potentialDuplicate = pairs[j]
            if(original.id === potentialDuplicate.id) {
                continue
            }

            if(pairCheck0 === potentialDuplicate.pair || pairCheck1 === potentialDuplicate.pair) {
                const [duplicate, created] = await getOrAddDuplicatePair(chain, dex, original.id, potentialDuplicate.id)
                if(created) {
                    duplicateCount += 1
                }
            }
        }
    }

    return duplicateCount
}


const run = async () => {

    // Token data
    console.log("Tokens")
    const duplicates = {
        tokens: {},
        pairs: {},
    }
    const chains = []
    for (let i = 0; i < dataSources.length; i += 1) {
        const poolMeta = dataSources[i]
        const chain = poolMeta.chain
        if(!chains.includes(chain)) {
            chains.push(chain)
        }
    }

    for (let i = 0; i < chains.length; i += 1) {
        duplicates.tokens[chains[i]] = await processTokensForChain(chains[i])
    }

    // Pair data
    console.log("Pairs")
    for (let i = 0; i < dataSources.length; i += 1) {
        const poolMeta = dataSources[i]
        const chain = poolMeta.chain
        const dex = poolMeta.dex

        if(duplicates.pairs[chain] === undefined) {
            duplicates.pairs[chain] = {}
        }

        duplicates.pairs[chain][dex] = await processPairsForChain(chain, dex)
    }

    console.log("New duplicates found")
    console.log(JSON.stringify(duplicates, null, 2))

    return "Done"
}

run().then(console.log)
