const {
    getTokensToFetchFromCoingecko,
    updateTokenWithCoingeckoData,
    getPairsToFetchFromCoingecko,
    updatePairWithCoingeckoData,
} = require("./db")
const {dataSources} = require("./sources")
const Web3 = require("web3");

const CG_WAIT = 2500; // coin gecko API limited to 30 calls/minute, so wait 2.5 seconds between calls.

const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay))

const processTokensForChain = async(chain) => {
    console.log(chain)

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
                    console.log("updated", token.id, tData.coingecko_coin_id, tData.total_supply, tData.volume_usd.h24, mc)
                } else {
                    console.log("not found", chain, tData.address)
                }
            }
        }
    }
}

const processPairsForChain = async(chain, dex) => {
    console.log(chain, dex)

    const pairs = await getPairsToFetchFromCoingecko(chain, dex)

    const pairCollection = []

    while(pairs.length > 30) {
        pairCollection.push(pairs.splice(0,30))
    }

    pairCollection.push(pairs)

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

                const baseTokenContract = pDataJson.data[k].relationships.base_token.data.id.split("_")[1]
                const quoteTokenContract = pDataJson.data[k].relationships.quote_token.data.id.split("_")[1]

                let t0Price = 0
                let t1Price = 0

                if(Web3.utils.toChecksumAddress(t0Contract) === Web3.utils.toChecksumAddress(baseTokenContract)) {
                    t0Price = pData.base_token_price_quote_token
                }
                if(Web3.utils.toChecksumAddress(t1Contract) === Web3.utils.toChecksumAddress(baseTokenContract)) {
                    t1Price = pData.base_token_price_quote_token
                }
                if(Web3.utils.toChecksumAddress(t0Contract) === Web3.utils.toChecksumAddress(quoteTokenContract)) {
                    t0Price = pData.quote_token_price_base_token
                }
                if(Web3.utils.toChecksumAddress(t1Contract) === Web3.utils.toChecksumAddress(quoteTokenContract)) {
                    t1Price = pData.quote_token_price_base_token
                }

                const pair = await updatePairWithCoingeckoData(thisPair.id, mc, pcp24h, buys, sells, buyers, sellers, vol24h, t0Price, t1Price)
                if(pair) {
                    console.log("updated", pair.id, mc, pcp24h, buys, sells, buyers, sellers, vol24h, t0Price, t1Price)
                } else {
                    console.log("not found", chain, pData.address)
                }
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
