import type { NextApiRequest, NextApiResponse } from 'next'
import {getServerSession} from "next-auth";
import {authOptions} from "./auth/[...nextauth]";
import {ExtendedSessionUser} from "../../types/types";
import {dataSources} from "../../lib/sources"
import {chainInfo} from "../../lib/chains"
import {ApolloClient, gql, InMemoryCache} from "@apollo/client";


const getCurrentBlockNumber = async(rpc) => {
    const id = Math.floor(Math.random() * 1000000) + 1

    const data = {
        "jsonrpc": "2.0",
        "method": "eth_blockNumber",
        "params": [],
        "id":id
    }

    const options = {
        method: 'post',
        body: JSON.stringify(data),
        headers: {'Content-Type': 'application/json'}
    }

    const res = await fetch(rpc, options)
    const json = await res.json()
    return parseInt(json.result, 16)
}

const genQuery = (poolsName, addrStr, blockNum) => {
    const blockGteQuery = (blockNum === null) ? "" : `block: {number: ${blockNum}},`
    return `
        ${poolsName}(
        ${blockGteQuery}
        where: {
    id_in: [${addrStr.toLowerCase()}]
    }
    ) {
    id
    token0 {
    id
    symbol
    }
    token1 {
    id
    symbol
    }
    token0Price
    token1Price
    }
    `
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {

    const retData = {
        prices: [],
        chain: "",
        dex: "",
        addresses: "",
        error: "",
        success: false,
    }

    const session = await getServerSession(req, res, authOptions)

    if (!(session.user as ExtendedSessionUser).isAuthotised) {
        retData.error = "not authorised"
        return res.status(403).json(retData)
    }

    if(!req.query?.chain || !req.query?.dex || !req.query?.addresses) {
        retData.error = "Chain, dex and addresses required"
        return res.status(400).json(retData)
    }

    const chain = String(req.query?.chain)
    const dex = String(req.query?.dex)
    const addresses = String(req.query?.addresses).split(",")
    let minutes = (req.query?.mins === undefined) ? 0 : parseInt(String(req.query?.mins))
    if(minutes > 10) {
        // max 10 minutes
        minutes = 10
    }

    if(chain === "bsc") {
        if(minutes > 4) {
            minutes = 4
        }
    }

    const addrStr = `"${addresses.join('","')}"`
    const blocksPerMin = chainInfo[chain]?.blocksPerMin
    const rpc = chainInfo[chain]?.rpc
    retData.chain = chain
    retData.dex = dex
    retData.addresses = addrStr

    let poolsName = null
    let url = null

    for(let i = 0; i < dataSources.length; i += 1) {
        const ds = dataSources[i]
        if(chain === ds.chain && dex === ds.dex) {
            poolsName = ds.graphql.poolsName
            url = ds.graphql.url
        }
    }

    if(!poolsName || !url) {
        retData.error = `could not find subgraph info`
        return res.status(400).json(retData)
    }

    const client = new ApolloClient({
        uri: url,
        cache: new InMemoryCache(),
    });

    const qArray = []

    let subBlocks = 0
    qArray.push(`p0: ${genQuery(poolsName, addrStr, null)}`)

    if(minutes > 0) {
        const currentBlock = await getCurrentBlockNumber(rpc)
        const lastBlock = currentBlock - 1
        subBlocks = minutes * blocksPerMin

        for(let p = 0; p < subBlocks; p += 1) {
            qArray.push(`p${p+1}: ${genQuery(poolsName, addrStr, lastBlock - p)}`)
        }
    }

    const query = gql`{
        ${qArray.join(",")}
    }`

    let result = null
    try {
        result = await client.query({
            query,
        })
    } catch(e) {
        console.log(e)
        retData.error = e.error
        return res.status(400).json(retData)
    }

    if(result.errors) {
        let errMsg = ""
        for(let i = 0; i < result.errors.length; i += 1) {
            errMsg += `${i}: ${result.errors[i].message}.`
        }
        retData.error = errMsg
        return res.status(400).json(retData)
    }

    const prices = []

    for(let p = 0; p <= subBlocks; p += 1) {
        for (let i = 0; i < result.data[`p${p}`].length; i += 1) {
            const d = result.data[`p${p}`][i]
            prices.push(
                {
                    chain,
                    dex,
                    token0ContractAddress: d.token0.id,
                    token0Symbol: d.token0.symbol,
                    token0Price: d.token0Price,
                    token1ContractAddress: d.token1.id,
                    token1Symbol: d.token1.symbol,
                    token1Price: d.token1Price,
                    pairContractAddress: d.id,
                }
            )
        }
    }

    retData.prices = prices
    retData.success = true

    return res.status(200).json(retData)

}
