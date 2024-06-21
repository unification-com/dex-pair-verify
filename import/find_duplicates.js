const {
    getAllTokenSymbolsForChain,
    getOrAddDuplicateTokenSymbol,
    getAllPairsForChainDex,
    getOrAddDuplicatePair,
} = require("./db")
const {dataSources} = require("./sources")

const processTokensForChain = async(chain) => {
    console.log(chain)
    const tokens = await getAllTokenSymbolsForChain(chain)

    for(let i = 0; i < tokens.length; i += 1) {
        const original = tokens[i]
        for(let j = 0; j < tokens.length; j += 1) {
            const potentialDuplicate = tokens[j]

            if(original.id === potentialDuplicate.id) {
                continue
            }

            if(original.symbol === potentialDuplicate.symbol) {
                console.log("potential duplicate token symbol", original.symbol, potentialDuplicate.symbol)
                const [duplicate, created] = await getOrAddDuplicateTokenSymbol(chain, original.id, potentialDuplicate.id)
                console.log(duplicate.id, created)
            }
        }
    }

}

const processPairsForChain = async(chain, dex) => {
    console.log(chain, dex)

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
                console.log("found potential duplicate pair", original.pair, potentialDuplicate.pair)
                const [duplicate, created] = await getOrAddDuplicatePair(chain, dex, original.id, potentialDuplicate.id)
                console.log(duplicate.id, created)
            }
        }
    }
}


const run = async () => {

    // Token data
    console.log("Tokens")
    const chains = []
    for (let i = 0; i < dataSources.length; i += 1) {
        const poolMeta = dataSources[i]
        const chain = poolMeta.chain
        if(!chains.includes(chain)) {
            chains.push(chain)
        }
    }

    for (let i = 0; i < chains.length; i += 1) {
        await processTokensForChain(chains[i])
    }

    // Pair data
    console.log("Pairs")
    for (let i = 0; i < dataSources.length; i += 1) {
        const poolMeta = dataSources[i]
        const chain = poolMeta.chain
        const dex = poolMeta.dex

        await processPairsForChain(chain, dex)
    }

    return "Done"
}

run().then(console.log)
