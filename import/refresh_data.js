const {
    getTokensToFetchFromCoingecko,
    updateTokenWithCoingeckoData,
    getPairsToFetchFromCoingecko,
    updatePairWithCoingeckoData,
    updatePairWithDexData,
    updateTokenWithTxCountFromDex,
    getOrCreateEmptyThresholds,
} = require("./db")
const {dataSources} = require("../lib/sources")
const Web3 = require("web3");
const {ApolloClient, InMemoryCache} = require("@apollo/client");

const CG_WAIT = 2500; // coin gecko API limited to 30 calls/minute, so wait 2.5 seconds between calls.

const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay))

const processTokenDataFromCoinGeckoForChain = async(chain) => {
    console.log("Tokens Coin Gecko", chain)

    const tokens = await getTokensToFetchFromCoingecko(chain)

    const tokenCollection = []

    while(tokens.length > 30) {
        tokenCollection.push(tokens.splice(0,30))
    }
    tokenCollection.push(tokens)

    for(let i = 0; i < tokenCollection.length; i += 1) {
        if(i > 0) {
            console.log("wait 2.5s...")
            await sleep(CG_WAIT)
        }
        let tStr = ""
        const tArr = []
        const tokenList = tokenCollection[i]

        for (let j = 0; j < tokenList.length; j += 1) {
            tArr.push(Web3.utils.toChecksumAddress(tokenList[j].contractAddress))
        }

        tStr = tArr.join("%2C")

        const gcUrl = `https://api.geckoterminal.com/api/v2/networks/${chain}/tokens/multi/${tStr}`
        const response = await fetch(gcUrl)
        const tDataJson = await response.json()

        if(tDataJson.data) {
            console.log(tDataJson.data.length)
            for(let k = 0; k < tDataJson.data.length; k += 1) {
                const tData = tDataJson.data[k].attributes
                const mc = (tData.market_cap_usd === null) ? 0 : tData.market_cap_usd
                const cgId = (tData.coingecko_coin_id === null) ? "" : tData.coingecko_coin_id

                let tId = null
                for(let t = 0; t < tokenList.length; t += 1) {
                    if(Web3.utils.toChecksumAddress(tData.address) === Web3.utils.toChecksumAddress(tokenList[t].contractAddress)) {
                        tId = tokenList[t].id
                        break
                    }
                }

                if(tId === null) {
                    console.log("Erm, OK...")
                    continue
                }

                const token = await updateTokenWithCoingeckoData(tId, cgId, tData.total_supply, tData.decimals, tData.volume_usd.h24, mc)
                if(token) {
                    console.log("updated token", token.id, tData.coingecko_coin_id, tData.total_supply, tData.volume_usd.h24, mc)
                } else {
                    console.log("not found", chain, tData.address)
                }
            }
        }
    }
}

const processPairDataFromCoinGecko = async(chain, dex, pairs) => {
    console.log("Pairs Coin Gecko", chain, dex)
    const pairsCopy = [...pairs]

    const pairCollection = []

    while(pairsCopy.length > 30) {
        pairCollection.push(pairsCopy.splice(0,30))
    }

    pairCollection.push(pairsCopy)

    for(let i = 0; i < pairCollection.length; i += 1) {
        if(i > 0) {
            console.log("wait 2.5s...")
            await sleep(CG_WAIT)
        }
        let pStr = ""
        const pArr = []
        const pairList = pairCollection[i]

        for (let j = 0; j < pairList.length; j += 1) {
            pArr.push(Web3.utils.toChecksumAddress(pairList[j].contractAddress))
        }

        pStr = pArr.join("%2C")

        const gcUrl = `https://api.geckoterminal.com/api/v2/networks/${chain}/pools/multi/${pStr}`
        const response = await fetch(gcUrl)
        const pDataJson = await response.json()

        if(pDataJson.data) {
            console.log(pDataJson.data.length)
            for(let k = 0; k < pDataJson.data.length; k += 1) {
                const pData = pDataJson.data[k].attributes

                let pcp24h = 0
                let buys = 0
                let sells = 0
                let buyers = 0
                let sellers = 0
                let vol24h = 0

                const mc = (pData.market_cap_usd === null) ? 0 : pData.market_cap_usd

                if(pData?.price_change_percentage !== null) {
                    pcp24h = (pData.price_change_percentage?.h24 === null) ? 0 : pData.price_change_percentage.h24
                }
                if(pData.transactions !== null) {
                    buys = (pData.transactions.h24?.buys === null) ? 0 : pData.transactions.h24?.buys
                }
                if(pData.transactions !== null) {
                    sells = (pData.transactions.h24?.sells === null) ? 0 : pData.transactions.h24?.sells
                }
                if(pData.transactions !== null) {
                    buyers = (pData.transactions.h24?.buyers === null) ? 0 : pData.transactions.h24?.buyers
                }
                if(pData.transactions !== null) {
                    sellers = (pData.transactions.h24?.sellers === null) ? 0 : pData.transactions.h24?.sellers
                }
                if(pData?.volume_usd !== null) {
                    vol24h = (pData.volume_usd?.h24 === null) ? 0 : pData.volume_usd.h24
                }

                let thisPair = null
                for(let t = 0; t < pairList.length; t += 1) {
                    if(Web3.utils.toChecksumAddress(pData.address) === Web3.utils.toChecksumAddress(pairList[t].contractAddress)) {
                        thisPair = pairList[t]
                        break
                    }
                }

                if(thisPair === null) {
                    console.log("Erm, OK...")
                    continue
                }

                // prices
                const t0Contract = thisPair.token0.contractAddress
                const t1Contract = thisPair.token1.contractAddress

                let baseTokenContract = null
                let quoteTokenContract = null

                if(pDataJson.data[k].relationships?.base_token?.data?.id !== undefined) {
                    const btArr = pDataJson.data[k].relationships.base_token.data.id.split("_")
                    baseTokenContract = btArr[btArr.length - 1]
                }

                if(pDataJson.data[k].relationships?.quote_token?.data?.id !== undefined) {
                    const qtArr = pDataJson.data[k].relationships.quote_token.data.id.split("_")
                    quoteTokenContract = qtArr[qtArr.length - 1]
                }

                let t0Price = 0
                let t1Price = 0

                if(baseTokenContract !== null && quoteTokenContract !== null) {
                    if(Web3.utils.toChecksumAddress(t0Contract) === Web3.utils.toChecksumAddress(baseTokenContract)) {
                        t0Price = (pData?.base_token_price_quote_token === null) ? 0 : pData.base_token_price_quote_token
                    }
                    if(Web3.utils.toChecksumAddress(t1Contract) === Web3.utils.toChecksumAddress(baseTokenContract)) {
                        t1Price = (pData?.base_token_price_quote_token === null) ? 0 : pData.base_token_price_quote_token
                    }
                    if(Web3.utils.toChecksumAddress(t0Contract) === Web3.utils.toChecksumAddress(quoteTokenContract)) {
                        t0Price = (pData?.quote_token_price_base_token === null) ? 0 : pData.quote_token_price_base_token
                    }
                    if(Web3.utils.toChecksumAddress(t1Contract) === Web3.utils.toChecksumAddress(quoteTokenContract)) {
                        t1Price = (pData?.quote_token_price_base_token === null) ? 0 : pData.quote_token_price_base_token
                    }
                }

                const pair = await updatePairWithCoingeckoData(thisPair.id, mc, pcp24h, buys, sells, buyers, sellers, vol24h, t0Price, t1Price)
                if(pair) {
                    console.log("updated pair", pair.id, mc, pcp24h, buys, sells, buyers, sellers, vol24h, t0Price, t1Price)
                } else {
                    console.log("not found", chain, pData.address)
                }
            }
        }
    }
}

const processPairDataFromDexSubgraph = async(chain, dex, poolMeta, pairs) => {
    console.log("Pairs Subgraph", chain, dex)
    const pairsCopy = [...pairs]

    const pairCollection = []

    while(pairsCopy.length > 100) {
        pairCollection.push(pairsCopy.splice(0,100))
    }

    pairCollection.push(pairsCopy)

    const client = new ApolloClient({
        uri: poolMeta.graphql.url,
        cache: new InMemoryCache(),
    });

    let poolResArray = []

    for(let i = 0; i < pairCollection.length; i += 1) {
        let pStr = ""
        const pArr = []
        const pairList = pairCollection[i]

        for (let j = 0; j < pairList.length; j += 1) {
            pArr.push(Web3.utils.toChecksumAddress(pairList[j].contractAddress))
        }
        pStr = `"${pArr.join('","')}"`

        const result = await client.query({
            query: poolMeta.graphql.funcQueryWithAddressList(pStr),
        })
        const poolRes = result.data[poolMeta.graphql.poolsName]
        poolResArray = poolResArray.concat(poolRes)
    }

    for (let i = 0; i < poolResArray.length; i += 1) {
        const pRes = poolResArray[i]

        const reserveUSD = pRes[poolMeta.graphql.reserveUSD]
        const reserveNativeCurrency = pRes[poolMeta.graphql.reserveNativeCurrency]
        const reserve0 = pRes[poolMeta.graphql.reserve0]
        const reserve1 = pRes[poolMeta.graphql.reserve1]
        const txCount = (poolMeta.graphql.txCount !== null) ? pRes[poolMeta.graphql.txCount] : 0
        const volumeUSD = pRes[poolMeta.graphql.volumeUSD]
        const token0 = pRes.token0
        const token0TxCount = (token0[poolMeta.graphql.txCount] !== null) ? token0[poolMeta.graphql.txCount] : 0
        const token1 = pRes.token1
        const token1TxCount = (token1[poolMeta.graphql.txCount] !== null) ? token1[poolMeta.graphql.txCount] : 0
        const pairAddress = Web3.utils.toChecksumAddress(pRes.id)

        let thisPair = null
        for(let t = 0; t < pairs.length; t += 1) {
            if(Web3.utils.toChecksumAddress(pairAddress) === Web3.utils.toChecksumAddress(pairs[t].contractAddress)) {
                thisPair = pairs[t]
                break
            }
        }

        if(thisPair === null) {
            console.log("Erm, OK...")
            continue
        }

        const t0up = await updateTokenWithTxCountFromDex(thisPair.token0.id, token0TxCount)
        if(t0up) {
            console.log("updated token", thisPair.token0.id, token0TxCount)
        }
        const t1up = await updateTokenWithTxCountFromDex(thisPair.token1.id, token1TxCount)
        if(t1up) {
            console.log("updated token", thisPair.token1.id, token1TxCount)
        }


        const pair = await updatePairWithDexData(thisPair.id, reserveUSD, volumeUSD, txCount, reserveNativeCurrency, reserve0, reserve1)
        if(pair) {
            console.log("updated pair", pair.id, reserveUSD, volumeUSD, txCount, reserveNativeCurrency, reserve0, reserve1)
        } else {
            console.log("not found", chain, thisPair.address)
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

    // Get token data from CoinGecko Terminal - market cap, CG ID etc. for all tokens in the DB
    for (let i = 0; i < chains.length; i += 1) {
        await processTokenDataFromCoinGeckoForChain(chains[i])
    }

    // Pair data
    console.log("Pairs")
    for (let i = 0; i < dataSources.length; i += 1) {
        const poolMeta = dataSources[i]
        const chain = poolMeta.chain
        const dex = poolMeta.dex

        const pairs = await getPairsToFetchFromCoingecko(chain, dex)

        // Check and update existing pairs in the DB, grabbing data from CoinGecko
        await processPairDataFromCoinGecko(chain, dex, pairs)

        // Check and update existing pairs in the DB, grabbing data from DEX
        await processPairDataFromDexSubgraph(chain, dex, poolMeta, pairs)

        // ensure db has default/empty thresholds
        const [thresholds, created] = await getOrCreateEmptyThresholds(chain, dex)
    }

    return "Done"
}

run().then(console.log)
