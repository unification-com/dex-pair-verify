const {gql} = require("@apollo/client");

const dataSources = [
    {
        chain: "eth",
        dex: "uniswap_v2",
        // Canonical DEX factory address per (chain, dex), hand-curated and
        // verified against each project's docs / the chain explorer. The
        // verdict engine's dexFactoryMatchesCanonical fence (A.2) checks a
        // pair's factory against this; an empty string means "skip that fence
        // for this source" until the operator confirms the address.
        canonicalFactoryAddress: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
        onCoinGeckoTerminal: true,
        last_page: 10,
        // Per-source verdict-engine floors, seeded into a fresh Threshold row
        // (A.8). minLiquidityUsd is the soft gate (below → NeedsReview);
        // hardMinLiquidityUsd auto-rejects genuine dust. Derived from the
        // observed reserveUsd distribution of the first full sweep — deep
        // venues hold liquidity throughout, so their floors sit high; the thin
        // venues run out of real depth fast, so theirs stay modest to keep
        // coverage while still culling manipulable pools. Operator-tunable per
        // (chain, dex) at /admin/thresholds; these are only the cold-start
        // defaults.
        // minTxCount is a conservative pre-data starter (T7) — re-tune per source
        // from the 24h-trade distribution after the next full ingest, the same
        // way the liquidity floors were tuned (A.8).
        defaultThresholds: { minLiquidityUsd: 25000, hardMinLiquidityUsd: 5000, minTxCount: 5 },
        graphql: {
            poolsName: "pairs",
            poolName: "pair",
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
        canonicalFactoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        onCoinGeckoTerminal: true,
        last_page: 10,
        // Deep venue — floors anchored near the observed p10 (A.8). See uniswap_v2.
        defaultThresholds: { minLiquidityUsd: 30000, hardMinLiquidityUsd: 5000, minTxCount: 5 },
        graphql: {
            poolsName: "pools",
            poolName: "pool",
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
        canonicalFactoryAddress: "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac",
        onCoinGeckoTerminal: true,
        last_page: 10,
        // Thinner venue — modest floors to preserve coverage while culling dust (A.8). See uniswap_v2.
        defaultThresholds: { minLiquidityUsd: 10000, hardMinLiquidityUsd: 2000, minTxCount: 3 },
        graphql: {
            poolsName: "pairs",
            poolName: "pair",
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
        canonicalFactoryAddress: "0x115934131916C8b277DD010Ee02de363c09d037c",
        onCoinGeckoTerminal: true,
        last_page: 10,
        // Thin venue — low floors to keep coverage on a shallow market (A.8). See uniswap_v2.
        defaultThresholds: { minLiquidityUsd: 5000, hardMinLiquidityUsd: 2000, minTxCount: 1 },
        graphql: {
            poolsName: "pairs",
            poolName: "pair",
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
        chain: "polygon_pos",
        dex: "quickswap_v3",
        canonicalFactoryAddress: "0x411b0fAcC3489691f28ad58c47006AF5E3Ab3A28",
        onCoinGeckoTerminal: true,
        last_page: 10,
        // Thin venue — low floors to keep coverage on a shallow market (A.8). See uniswap_v2.
        defaultThresholds: { minLiquidityUsd: 5000, hardMinLiquidityUsd: 2000, minTxCount: 1 },
        graphql: {
            poolsName: "pools",
            poolName: "pool",
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
        canonicalFactoryAddress: "0xA818b4F111Ccac7AA31D0BCc0806d64F2E0737D7",
        onCoinGeckoTerminal: true,
        last_page: 10,
        // Thinnest venue — low floors to keep coverage on a shallow market (A.8). See uniswap_v2.
        defaultThresholds: { minLiquidityUsd: 5000, hardMinLiquidityUsd: 2000, minTxCount: 1 },
        graphql: {
            poolsName: "pairs",
            poolName: "pair",
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
    {
        chain: "bsc",
        dex: "bsc_pancakeswap_v3",
        // GeckoTerminal slug differs from our internal dex id (verified via
        // `yarn verify-gt`). Query GT by gtDex, store by dex.
        gtDex: "pancakeswap-v3-bsc",
        canonicalFactoryAddress: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
        onCoinGeckoTerminal: true,
        last_page: 10,
        // Deep venue — floors anchored near the observed p10 (A.8). See uniswap_v2.
        defaultThresholds: { minLiquidityUsd: 35000, hardMinLiquidityUsd: 5000, minTxCount: 5 },
        graphql: {
            poolsName: "pools",
            poolName: "pool",
            reserveUSD: "totalValueLockedUSD",
            reserveNativeCurrency: "totalValueLockedETH",
            reserve0: "totalValueLockedToken0",
            reserve1: "totalValueLockedToken1",
            txCount: "txCount",
            volumeUSD: "volumeUSD",
            url: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.THEGRAPH_API_KEY}/subgraphs/id/A1fvJWQLBeUAggX2WQTMm3FKjXTekNXo77ZySun4YN2m`,
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
                }`
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
        chain: "qom",
        dex: "qomswap_v2",
        // TODO(operator): paste the QomSwap V2 factory address from the QOM
        // explorer (scan.qom.network). Left empty so the factory fence skips
        // this source until confirmed — an unverified address here would make
        // the verdict engine reject every real qomswap_v2 pair.
        canonicalFactoryAddress: "",
        onCoinGeckoTerminal: false,
        last_page: 10,
        graphql: {
            poolsName: "pairs",
            poolName: "pair",
            reserveUSD: "reserveUSD",
            reserveNativeCurrency: "reserveBNB",
            reserve0: "reserve0",
            reserve1: "reserve1",
            txCount: "totalTransactions",
            volumeUSD: "volumeUSD",
            url: `https://subgraph.qomswap.com/subgraphs/name/test/exchange`,
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
                        totalTransactions
                        volumeUSD
                    }
                }`
            },
            funcQueryTop1000: function () {
                return gql`{
                    pairs(
                        first: 1000,
                        orderBy: reserveBNB,
                        orderDirection: desc,
                        where : {
                            reserveUSD_gt: "100000"
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
                        totalTransactions
                        volumeUSD
                    }
                }`
            },
        },
    },
]

module.exports = { dataSources }
