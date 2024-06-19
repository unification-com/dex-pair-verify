const {gql} = require("@apollo/client");

const dataSources = [
    {
        chain: "eth",
        dex: "uniswap_v2",
        last_page: 10,
        toChecksumAddress: false,
        graphql: {
            poolName: "pairs",
            totalValueLockedUSD: "reserveUSD",
            txCount: "txCount",
            volumeUSD: "volumeUSD",
            url: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.THEGRAPH_API_KEY}/subgraphs/id/EYCKATKGBKLWvSfwvBjzfCBmGwYNdVkduYXVivCsLRFu`,
            funcQueryWithAddressList: function (addresses) {
                return gql`{
                    pairs(where: {id_in: [${addresses}]}) {
                        id
                        reserveUSD
                        token0 {
                            id
                            name
                            symbol
                        }
                        token1 {
                            id
                            name
                            symbol
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
                        orderBy: reserveUSD,
                        orderDirection: desc,
                        where : {
                            reserveUSD_gt: "100000",
                            txCount_gt: "1000"
                        }
                    ) {
                        id
                        reserveUSD
                        token0 {
                            id
                            name
                            symbol
                        }
                        token1 {
                            id
                            name
                            symbol
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
        toChecksumAddress: false,
        graphql: {
            poolName: "pools",
            totalValueLockedUSD: "totalValueLockedUSD",
            txCount: "txCount",
            volumeUSD: "volumeUSD",
            url: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.THEGRAPH_API_KEY}/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV`,
            funcQueryWithAddressList: function (addresses) {
                return gql`{
                    pools(
                        where: {id_in: [${addresses}]}
                    ) {
                        id
                        totalValueLockedUSD
                        txCount
                        volumeUSD
                        token1 {
                            id
                            name
                            symbol
                        }
                        token0 {
                            id
                            name
                            symbol
                        }
                    }
                }
                `
            },
            funcQueryTop1000: function () {
                return gql`{
                    pools(
                        first: 1000,
                        orderBy: totalValueLockedUSD,
                        orderDirection: desc,
                        where : {
                            totalValueLockedUSD_gt: "100000",
                            txCount_gt: "1000"
                        }
                    ) {
                        id
                        totalValueLockedUSD
                        token0 {
                            id
                            name
                            symbol
                        }
                        token1 {
                            id
                            name
                            symbol
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
        dex: "sushiswap",
        last_page: 10,
        toChecksumAddress: false,
        graphql: {
            poolName: "pairs",
            totalValueLockedUSD: "reserveUSD",
            txCount: "txCount",
            volumeUSD: "volumeUSD",
            url: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.THEGRAPH_API_KEY}/subgraphs/id/6NUtT5mGjZ1tSshKLf5Q3uEEJtjBZJo1TpL5MXsUBqrT`,
            funcQueryWithAddressList: function (addresses) {
                return gql`{
                    pairs(where: {id_in: [${addresses}]}) {
                        id
                        reserveUSD
                        token0 {
                            id
                            name
                            symbol
                        }
                        token1 {
                            id
                            name
                            symbol
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
                        orderBy: reserveUSD,
                        orderDirection: desc,
                        where : {
                            reserveUSD_gt: "100000",
                            txCount_gt: "1000"
                        }
                    ) {
                        id
                        reserveUSD
                        token0 {
                            id
                            name
                            symbol
                        }
                        token1 {
                            id
                            name
                            symbol
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
        toChecksumAddress: false,
        graphql: {
            poolName: "pairs",
            totalValueLockedUSD: "reserveUSD",
            txCount: "txCount",
            volumeUSD: "volumeUSD",
            url: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.THEGRAPH_API_KEY}/subgraphs/id/61LXXvGA1KXkJZbCceYqw9APcwTGefK5MytwnVsdAQpw`,
            funcQueryWithAddressList: function (addresses) {
                return gql`{
                    pairs(where: {id_in: [${addresses}]}) {
                        id
                        reserveUSD
                        token0 {
                            id
                            name
                            symbol
                        }
                        token1 {
                            id
                            name
                            symbol
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
                        orderBy: reserveUSD,
                        orderDirection: desc,
                        where : {
                            reserveUSD_gt: "50000",
                            txCount_gt: "250"
                        }
                    ) {
                        id
                        reserveUSD
                        token0 {
                            id
                            name
                            symbol
                        }
                        token1 {
                            id
                            name
                            symbol
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
        toChecksumAddress: true,
        graphql: {
            poolName: "pairs",
            totalValueLockedUSD: "reserveUSD",
            txCount: "totalTransactions",
            volumeUSD: "volumeUSD",
            url: `https://open-platform.nodereal.io/${process.env.NODEREAL_API_KEY}/pancakeswap-free/graphql`,
            funcQueryWithAddressList: function (addresses) {
                return gql`{
                    pairs(where: {id_in: [${addresses}]}) {
                        id
                        reserveUSD
                        token0 {
                            id
                            name
                            symbol
                        }
                        token1 {
                            id
                            name
                            symbol
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
                            totalTransactions_gt: "5000"
                        }
                    ) {
                        id
                        reserveUSD
                        token0 {
                            id
                            name
                            symbol
                        }
                        token1 {
                            id
                            name
                            symbol
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
        dex: "quickswap",
        last_page: 10,
        toChecksumAddress: false,
        graphql: {
            poolName: "pairs",
            totalValueLockedUSD: "reserveUSD",
            txCount: null,
            volumeUSD: "volumeUSD",
            url: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.THEGRAPH_API_KEY}/subgraphs/id/FUWdkXWpi8JyhAnhKL5pZcVshpxuaUQG8JHMDqNCxjPd`,
            funcQueryWithAddressList: function (addresses) {
                return gql`{
                    pairs(where: {id_in: [${addresses}]}) {
                        id
                        reserveUSD
                        token0 {
                            id
                            name
                            symbol
                        }
                        token1 {
                            id
                            name
                            symbol
                        }
                        volumeUSD
                    }
                }`
            },
            funcQueryTop1000: function () {
                return gql`{
                    pairs(
                        first: 1000,
                        orderBy: reserveUSD,
                        orderDirection: desc,
                        where : {
                            reserveUSD_gt: "100000"
                        }
                    ) {
                        id
                        reserveUSD
                        token0 {
                            id
                            name
                            symbol
                        }
                        token1 {
                            id
                            name
                            symbol
                        }
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
        toChecksumAddress: false,
        graphql: {
            poolName: "pairs",
            totalValueLockedUSD: "reserveUSD",
            txCount: "txCount",
            volumeUSD: "volumeUSD",
            url: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.THEGRAPH_API_KEY}/subgraphs/id/HTxWvPGcZ5oqWLYEVtWnVJDfnai2Ud1WaABiAR72JaSJ`,
            funcQueryWithAddressList: function (addresses) {
                return gql`{
                    pairs(where: {id_in: [${addresses}]}) {
                        id
                        reserveUSD
                        token0 {
                            id
                            name
                            symbol
                        }
                        token1 {
                            id
                            name
                            symbol
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
                        orderBy: reserveUSD,
                        orderDirection: desc,
                        where : {
                            reserveUSD_gt: "10000",
                            txCount_gt: "1000"
                        }
                    ) {
                        id
                        reserveUSD
                        token0 {
                            id
                            name
                            symbol
                        }
                        token1 {
                            id
                            name
                            symbol
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
