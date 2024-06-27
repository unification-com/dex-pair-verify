import type { NextApiRequest, NextApiResponse } from 'next'
import {getServerSession} from "next-auth";
import {authOptions} from "./auth/[...nextauth]";
import {ExtendedSessionUser} from "../../types/types";
import {dataSources} from "../../import/sources"
import {ApolloClient, gql, InMemoryCache} from "@apollo/client";

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {

    const retData = {
        prices: [],
        chain: "",
        dex: "",
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
    const addrStr = `"${addresses.join('","')}"`
    retData.chain = chain
    retData.dex = dex

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

    const query = gql`{
        ${poolsName}(
        where: {id_in: [${addrStr.toLowerCase()}]}
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
    }`

    let result = null
    try {
        result = await client.query({
            query,
        })
    } catch(e) {
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

    for(let i = 0; i < result.data[poolsName].length; i += 1) {
        const d = result.data[poolsName][i]
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

    retData.prices = prices
    retData.success = true

    return res.status(200).json(retData)

}
