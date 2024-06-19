require('dotenv').config()
const {ApolloClient, InMemoryCache, ApolloProvider, gql} = require('@apollo/client')
const Web3 = require('web3');
const { dataSources } = require('./sources')
const {
    getOrAddStagingPair,
    getOrAddToken,
    getOrAddPair,
    getQueryContractAddresses,
    getStagingPair,
} = require('./db')

const CG_WAIT = 2500; // coin gecko API limited to 30 calls/minute, so wait 2.5 seconds between calls.

const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay))

const fetchFromCg = async () => {
    const results = {}
    for (let i = 0; i < dataSources.length; i += 1) {
        const pool = dataSources[i]
        const chain = pool.chain
        const dex = pool.dex
        if(!results[chain]) {
            results[chain] = {}
        }
        results[chain][dex] = {
            new: 0,
            existing: 0
        }
        for (let j = 1; j <= pool.last_page; j += 1) {
            console.log(chain, dex, j)
            const gcUrl = `https://api.geckoterminal.com/api/v2/networks/${chain}/dexes/${dex}/pools?page=${j}&sort=h24_tx_count_desc`
            const response = await fetch(gcUrl)
            const pairs = await response.json()
            for (let k = 0; k < pairs.data.length; k += 1) {
                const p = pairs.data[k]
                const pairContractAddress = (pool.toChecksumAddress) ? Web3.utils.toChecksumAddress(p.attributes.address) : p.attributes.address
                const t0Arr = p.relationships.base_token.data.id.split("_")
                const t0ContractAddress = (pool.toChecksumAddress) ? Web3.utils.toChecksumAddress(t0Arr[t0Arr.length - 1]) : t0Arr[t0Arr.length - 1]
                const t1Arr = p.relationships.quote_token.data.id.split("_")
                const t1ContractAddress = (pool.toChecksumAddress) ? Web3.utils.toChecksumAddress(t1Arr[t1Arr.length - 1]) : t1Arr[t1Arr.length - 1]
                const [staging, stCreated] = await getOrAddStagingPair(chain, dex, pairContractAddress, t0ContractAddress, t1ContractAddress)
                if(stCreated) {
                    results[chain][dex].new += 1
                } else {
                    results[chain][dex].existing += 1
                }
            }
            await sleep(CG_WAIT)
        }
    }
    console.log(results)
}

const fetchFromSubgraph = async () => {
    const results = {}
    for (let i = 0; i < dataSources.length; i += 1) {
        const poolMeta = dataSources[i]
        const chain = poolMeta.chain
        const dex = poolMeta.dex
        const addrArr = await getQueryContractAddresses(chain, dex, false)

        if(!results[chain]) {
            results[chain] = {}
        }
        results[chain][dex] = {
            new: 0,
            existing: 0
        }

        console.log(chain, dex)

        const first100 = addrArr.splice(0,100);

        const q1Addr = `"${first100.join('","')}"`
        const q2Addr = `"${addrArr.join('","')}"`

        const client = new ApolloClient({
            uri: poolMeta.graphql.url,
            cache: new InMemoryCache(),
        });

        const result1 = await client.query({
            query: poolMeta.graphql.funcQueryWithAddressList(q1Addr),
        })

        const result2 = await client.query({
            query: poolMeta.graphql.funcQueryWithAddressList(q2Addr),
        })

        const poolRes1 = result1.data[poolMeta.graphql.poolName]
        const poolRes2 = result2.data[poolMeta.graphql.poolName]

        const poolResArray = poolRes1.concat(poolRes2)

        for (let j = 0; j < poolResArray.length; j += 1) {
            const pRes = poolResArray[j]

            const totalValueLockedUSD = pRes[poolMeta.graphql.totalValueLockedUSD]
            const txCount = (poolMeta.graphql.txCount !== null) ? pRes[poolMeta.graphql.txCount] : 0
            const volumeUSD = pRes[poolMeta.graphql.volumeUSD]
            const token0 = pRes.token0
            const token0Address = (poolMeta.toChecksumAddress) ? Web3.utils.toChecksumAddress(token0.id) : token0.id
            const token1 = pRes.token1
            const token1Address = (poolMeta.toChecksumAddress) ? Web3.utils.toChecksumAddress(token1.id) : token1.id
            const pairAddress = (poolMeta.toChecksumAddress) ? Web3.utils.toChecksumAddress(pRes.id) : pRes.id

            let stRes = await getStagingPair(chain, dex, pairAddress, token0Address, token1Address)
            if (stRes === null) {
                stRes = await getStagingPair(chain, dex, pairAddress, token1Address, token0Address)
            }

            if (stRes) {
                // token0
                const [t0, t0Created] = await getOrAddToken(chain, token0Address, token0.name, token0.symbol, 1, "geckoterminal.com")
                // token1
                const [t1, t1Created] = await getOrAddToken(chain, token1Address, token1.name, token1.symbol, 1, "geckoterminal.com")

                const pSym = `${t0.symbol}-${t1.symbol}`

                const [p, pCreated] = await getOrAddPair(chain, dex, pairAddress, pSym, t0.id, t1.id, totalValueLockedUSD, volumeUSD, txCount, 1, "geckoterminal.com")

                if(pCreated) {
                    results[chain][dex].new += 1
                } else {
                    results[chain][dex].existing += 1
                }
            }
        }
    }
    console.log(results)
}

const run = async () => {
    // 1. first stage pool data into a staging table - pair contract address, and token addresses
    await fetchFromCg()

    // 2. For each chain/dex pair, query pools from respective graphql
    await fetchFromSubgraph()

    return "Done"
}

run().then(console.log)
