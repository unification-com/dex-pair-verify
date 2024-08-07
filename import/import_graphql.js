require('dotenv').config()
const {ApolloClient, InMemoryCache, ApolloProvider, gql} = require('@apollo/client')
const Web3 = require('web3');
const { dataSources } = require('../lib/sources')
const {
    getOrAddToken,
    getOrAddPair,
    getStagingPair,
} = require('./db')

const fetchFromSubgraph = async () => {
    const results = {}
    for (let i = 0; i < dataSources.length; i += 1) {
        const poolMeta = dataSources[i]
        const chain = poolMeta.chain
        const dex = poolMeta.dex

        if(!results[chain]) {
            results[chain] = {}
        }
        results[chain][dex] = {
            new: 0,
            existing: 0,
            total: 0,
        }

        console.log(chain, dex)

        const client = new ApolloClient({
            uri: poolMeta.graphql.url,
            cache: new InMemoryCache(),
        });


        const result = await client.query({
            query: poolMeta.graphql.funcQueryTop1000(),
        })

        const poolResArray = result.data[poolMeta.graphql.poolsName]

        for (let j = 0; j < poolResArray.length; j += 1) {
            const pRes = poolResArray[j]

            results[chain][dex].total += 1

            const reserveUSD = pRes[poolMeta.graphql.reserveUSD]
            const reserveNativeCurrency = pRes[poolMeta.graphql.reserveNativeCurrency]
            const reserve0 = pRes[poolMeta.graphql.reserve0]
            const reserve1 = pRes[poolMeta.graphql.reserve1]
            const txCount = (poolMeta.graphql.txCount !== null) ? pRes[poolMeta.graphql.txCount] : 0
            const volumeUSD = pRes[poolMeta.graphql.volumeUSD]
            const token0 = pRes.token0
            const token0Address = Web3.utils.toChecksumAddress(token0.id)
            const token0TxCount = (poolMeta.graphql.txCount !== null) ? token0[poolMeta.graphql.txCount] : 0
            const token1 = pRes.token1
            const token1Address = Web3.utils.toChecksumAddress(token1.id)
            const token1TxCount = (poolMeta.graphql.txCount !== null) ? token1[poolMeta.graphql.txCount] : 0
            const pairAddress = Web3.utils.toChecksumAddress(pRes.id)

            // token0
            const [t0, t0Created] = await getOrAddToken(chain, token0Address, token0.name, token0.symbol, token0TxCount, 0, "")
            // token1
            const [t1, t1Created] = await getOrAddToken(chain, token1Address, token1.name, token1.symbol, token1TxCount, 0, "")

            const pSym = `${t0.symbol}-${t1.symbol}`

            const [p, pCreated] = await getOrAddPair(chain, dex, pairAddress, pSym, t0.id, t1.id, reserveUSD, reserveNativeCurrency, reserve0, reserve1, volumeUSD, txCount, 0, "")

            if(pCreated) {
                results[chain][dex].new += 1
            } else {
                results[chain][dex].existing += 1
            }
        }
    }
    console.log(results)
}

const run = async() => {
    await fetchFromSubgraph()

    return "Done"
}

run().then(console.log)
