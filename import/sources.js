const {gql} = require("@apollo/client");

const dataSources = [
    {
        chain: "eth",
        dex: "uniswap_v2",
        last_page: 10,
        graphql: {
            poolName: "pairs",
            reserveUSD: "reserveUSD",
            reserveNativeCurrency: "reserveETH",
            reserve0: "reserve0",
            reserve1: "reserve1",
            txCount: "txCount",
            volumeUSD: "volumeUSD",
            url: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.THEGRAPH_API_KEY}/subgraphs/id/EYCKATKGBKLWvSfwvBjzfCBmGwYNdVkduYXVivCsLRFu`,
            funcQueryWithAddressList: function (addresses) {
                return gql`{
                    pairs(where: {id_in: [${addresses.toLowerCase()}]}) {
                        id
                        reserveUSD
                        reserveETH
                        reserve0
                        reserve1
                        token0 {
                            id
                            name
                            symbol
                            txCount
                        }
                        token1 {
                            id
                            name
                            symbol
                            txCount
                        }
                        txCount
                        volumeUSD
                    }
                }`
            },
            funcQueryTop1000: function () {
                return gql`{
                    pairs(
                        first: 1000,
                        orderBy: reserveETH,
                        orderDirection: desc,
                        where : {
                            reserveUSD_gt: "100000",
                            txCount_gt: "10000"
                        }
                    ) {
                        id
                        reserveUSD
                        reserveETH
                        reserve0
                        reserve1
                        token0 {
                            id
                            name
                            symbol
                            txCount
                        }
                        token1 {
                            id
                            name
                            symbol
                            txCount
                        }
                        txCount
                        volumeUSD
                    }
                }`
            },
        },
    },
    {
        chain: "eth",
        dex: "uniswap_v3",
        last_page: 10,
        graphql: {
            poolName: "pools",
            reserveUSD: "totalValueLockedUSD",
            reserveNativeCurrency: "totalValueLockedETH",
            reserve0: "totalValueLockedToken0",
            reserve1: "totalValueLockedToken1",
            txCount: "txCount",
            volumeUSD: "volumeUSD",
            url: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.THEGRAPH_API_KEY}/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV`,
            funcQueryWithAddressList: function (addresses) {
                return gql`{
                    pools(
                        where: {id_in: [${addresses.toLowerCase()}]}
                    ) {
                        id
                        token1 {
                            id
                            name
                            symbol
                            txCount
                        }
                        token0 {
                            id
                            name
                            symbol
                            txCount
                        }
                        totalValueLockedUSD
                        totalValueLockedETH
                        totalValueLockedToken0
                        totalValueLockedToken1
                        txCount
                        volumeUSD
                    }
                }
                `
            },
            funcQueryTop1000: function () {
                return gql`{
                    pools(
                        first: 1000,
                        orderBy: totalValueLockedETH,
                        orderDirection: desc,
                        where : {
                            totalValueLockedUSD_gt: "100000",
                            txCount_gt: "10000"
                        }
                    ) {
                        id
                        token0 {
                            id
                            name
                            symbol
                            txCount
                        }
                        token1 {
                            id
                            name
                            symbol
                            txCount
                        }
                        totalValueLockedUSD
                        totalValueLockedETH
                        totalValueLockedToken0
                        totalValueLockedToken1
                        txCount
                        volumeUSD
                    }
                }`
            },
        },
    },
    {
        chain: "eth",
        dex: "sushiswap",
        last_page: 10,
        graphql: {
            poolName: "pairs",
            reserveUSD: "reserveUSD",
            reserveNativeCurrency: "reserveETH",
            reserve0: "reserve0",
            reserve1: "reserve1",
            txCount: "txCount",
            volumeUSD: "volumeUSD",
            url: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.THEGRAPH_API_KEY}/subgraphs/id/6NUtT5mGjZ1tSshKLf5Q3uEEJtjBZJo1TpL5MXsUBqrT`,
            funcQueryWithAddressList: function (addresses) {
                return gql`{
                    pairs(where: {id_in: [${addresses.toLowerCase()}]}) {
                        id
                        reserveUSD
                        reserveETH
                        reserve0
                        reserve1
                        token0 {
                            id
                            name
                            symbol
                            txCount
                        }
                        token1 {
                            id
                            name
                            symbol
                            txCount
                        }
                        txCount
                        volumeUSD
                    }
                }`
            },
            funcQueryTop1000: function () {
                return gql`{
                    pairs(
                        first: 1000,
                        orderBy: reserveETH,
                        orderDirection: desc,
                        where : {
                            reserveUSD_gt: "100000",
                            txCount_gt: "10000"
                        }
                    ) {
                        id
                        reserveUSD
                        reserveETH
                        reserve0
                        reserve1
                        token0 {
                            id
                            name
                            symbol
                            txCount
                        }
                        token1 {
                            id
                            name
                            symbol
                            txCount
                        }
                        txCount
                        volumeUSD
                    }
                }`
            },
        },
    },
    {
        chain: "eth",
        dex: "shibaswap",
        last_page: 10,
        graphql: {
            poolName: "pairs",
            reserveUSD: "reserveUSD",
            reserveNativeCurrency: "reserveETH",
            reserve0: "reserve0",
            reserve1: "reserve1",
            txCount: "txCount",
            volumeUSD: "volumeUSD",
            url: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.THEGRAPH_API_KEY}/subgraphs/id/61LXXvGA1KXkJZbCceYqw9APcwTGefK5MytwnVsdAQpw`,
            funcQueryWithAddressList: function (addresses) {
                return gql`{
                    pairs(where: {id_in: [${addresses.toLowerCase()}]}) {
                        id
                        reserveUSD
                        reserveETH
                        reserve0
                        reserve1
                        token0 {
                            id
                            name
                            symbol
                            txCount
                        }
                        token1 {
                            id
                            name
                            symbol
                            txCount
                        }
                        txCount
                        volumeUSD
                    }
                }`
            },
            funcQueryTop1000: function () {
                return gql`{
                    pairs(
                        first: 1000,
                        orderBy: reserveETH,
                        orderDirection: desc,
                        where : {
                            reserveUSD_gt: "100000",
                            txCount_gt: "10000"
                        }
                    ) {
                        id
                        reserveUSD
                        reserveETH
                        reserve0
                        reserve1
                        token0 {
                            id
                            name
                            symbol
                            txCount
                        }
                        token1 {
                            id
                            name
                            symbol
                            txCount
                        }
                        txCount
                        volumeUSD
                    }
                }`
            },
        },
    },
    {
        chain: "bsc",
        dex: "pancakeswap_v2",
        last_page: 10,
        graphql: {
            poolName: "pairs",
            reserveUSD: "reserveUSD",
            reserveNativeCurrency: "reserveBNB",
            reserve0: "reserve0",
            reserve1: "reserve1",
            txCount: "totalTransactions",
            volumeUSD: "volumeUSD",
            url: `https://open-platform.nodereal.io/${process.env.NODEREAL_API_KEY}/pancakeswap-free/graphql`,
            funcQueryWithAddressList: function (addresses) {
                return gql`{
                    pairs(where: {id_in: [${addresses.toLowerCase()}]}) {
                        id
                        reserveUSD
                        reserveBNB
                        reserve0
                        reserve1
                        token0 {
                            id
                            name
                            symbol
                            totalTransactions
                        }
                        token1 {
                            id
                            name
                            symbol
                            totalTransactions
                        }
                        volumeUSD
                        totalTransactions
                    }
                }`
            },
            funcQueryTop1000: function () {
                return gql`{
                    pairs(
                        first: 1000,
                        orderBy: trackedReserveBNB,
                        orderDirection: desc,
                        where : {
                            totalTransactions_gt: "10000"
                        }
                    ) {
                        id
                        reserveUSD
                        reserveBNB
                        reserve0
                        reserve1
                        token0 {
                            id
                            name
                            symbol
                            totalTransactions
                        }
                        token1 {
                            id
                            name
                            symbol
                            totalTransactions
                        }
                        volumeUSD
                        totalTransactions
                    }
                }`
            },
        },
    },
    {
        chain: "polygon_pos",
        dex: "quickswap_v3",
        last_page: 10,
        graphql: {
            poolName: "pools",
            reserveUSD: "totalValueLockedUSD",
            reserveNativeCurrency: "totalValueLockedMatic",
            reserve0: "totalValueLockedToken0",
            reserve1: "totalValueLockedToken1",
            txCount: "txCount",
            volumeUSD: "volumeUSD",
            url: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.THEGRAPH_API_KEY}/subgraphs/id/FqsRcH1XqSjqVx9GRTvEJe959aCbKrcyGgDWBrUkG24g`,
            funcQueryWithAddressList: function (addresses) {
                return gql`{
                    pools(
                        where: {id_in: [${addresses.toLowerCase()}]}
                    ) {
                        id
                        token1 {
                            id
                            name
                            symbol
                            txCount
                        }
                        token0 {
                            id
                            name
                            symbol
                            txCount
                        }
                        totalValueLockedUSD
                        totalValueLockedMatic
                        totalValueLockedToken0
                        totalValueLockedToken1
                        txCount
                        volumeUSD
                    }
                }`
            },
            funcQueryTop1000: function () {
                return gql`{
                    pools(
                        first: 1000,
                        orderBy: totalValueLockedMatic,
                        orderDirection: desc,
                        where : {
                            totalValueLockedUSD_gt: "100000",
                            txCount_gt: "10000"
                        }
                    ) {
                        id
                        token0 {
                            id
                            name
                            symbol
                            txCount
                        }
                        token1 {
                            id
                            name
                            symbol
                            txCount
                        }
                        totalValueLockedUSD
                        totalValueLockedMatic
                        totalValueLockedToken0
                        totalValueLockedToken1
                        txCount
                        volumeUSD
                    }
                }`
            },
        },
    },
    {
        chain: "xdai",
        dex: "honeyswap",
        last_page: 10,
        graphql: {
            poolName: "pairs",
            reserveUSD: "reserveUSD",
            reserveNativeCurrency: "reserveNativeCurrency",
            reserve0: "reserve0",
            reserve1: "reserve1",
            txCount: "txCount",
            volumeUSD: "volumeUSD",
            url: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.THEGRAPH_API_KEY}/subgraphs/id/HTxWvPGcZ5oqWLYEVtWnVJDfnai2Ud1WaABiAR72JaSJ`,
            funcQueryWithAddressList: function (addresses) {
                return gql`{
                    pairs(where: {id_in: [${addresses.toLowerCase()}]}) {
                        id
                        reserveUSD
                        reserveNativeCurrency
                        reserve0
                        reserve1
                        token0 {
                            id
                            name
                            symbol
                            txCount
                        }
                        token1 {
                            id
                            name
                            symbol
                            txCount
                        }
                        txCount
                        volumeUSD
                    }
                }`
            },
            funcQueryTop1000: function () {
                return gql`{
                    pairs(
                        first: 1000,
                        orderBy: reserveNativeCurrency,
                        orderDirection: desc,
                        where : {
                            reserveUSD_gt: "100000",
                            txCount_gt: "10000"
                        }
                    ) {
                        id
                        reserveUSD
                        reserveNativeCurrency
                        reserve0
                        reserve1
                        token0 {
                            id
                            name
                            symbol
                            txCount
                        }
                        token1 {
                            id
                            name
                            symbol
                            txCount
                        }
                        txCount
                        volumeUSD
                    }
                }`
            },
        },
    },
]

module.exports = { dataSources }
