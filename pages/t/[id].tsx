import { GetServerSideProps } from "next"
import React, {FormEvent, useEffect, useState} from "react"
import {NotificationManager} from 'react-notifications';
import {NumericFormat} from "react-number-format";

import ChainName from "../../components/ChainName";
import CoinGeckoCoinLink from "../../components/CoinGeckoCoinLink";
import ExplorerUrl from "../../components/ExplorerUrl";
import Layout from "../../components/shell/Layout"
import SortableTable from "../../components/SortableTable/SortableTable";
import StatusBadge from "../../components/ui/StatusBadge";
import prisma from '../../lib/prisma';
import {TokenProps} from "../../types/props";
import {TokenPairStatus} from "../../types/types";

export const getServerSideProps: GetServerSideProps = async ({ params }) => {

    const token = await prisma.token.findUnique({
        where: {
            id: String(params?.id),
        },
        include: {
            pairsToken0: {
                select: {
                    pair: true,
                    id: true,
                    contractAddress: true,
                    reserveUsd: true,
                    reserve0: true,
                    reserve1: true,
                    reserveNativeCurrency: true,
                    volumeUsd: true,
                    txCount: true,
                    status: true,
                    dex: true,
                },
            },
            pairsToken1: {
                select: {
                    pair: true,
                    id: true,
                    contractAddress: true,
                    reserveUsd: true,
                    reserve0: true,
                    reserve1: true,
                    reserveNativeCurrency: true,
                    volumeUsd: true,
                    txCount: true,
                    status: true,
                    dex: true,
                },
            },
            duplicateTokenSymbols: {
                select: {
                    duplicateToken: true,
                }
            }
        },
    });

    if (token === null) {
        return { notFound: true }
    }

    const similarTokens = await prisma.token.findMany({
        where: {
            symbol: token.symbol,
            NOT: {
                chain: token.chain
            }
        },
    })

    return {
        props: {token, similarTokens},
    }
}

type Props = {
    token: TokenProps;
    similarTokens: TokenProps[];
}

const Token: React.FC<Props> = (props) => {
    const [currentStatus, setCurrentStatus] = useState(props.token.status)

    // Re-sync when navigating to a different token — the pages router
    // re-renders this same component instance with new props.
    useEffect(() => {
        setCurrentStatus(props.token.status)
    }, [props.token.status])

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()

        const formData = new FormData(event.currentTarget)
        const response = await fetch('/api/admin/settokenstatus', {
            method: 'POST',
            body: formData,
        })

        // Handle response if necessary
        const res = await response.json()
        if (res.success) {
            NotificationManager.success("Success!", `Status changed to ${res.data.new_status}`, 5000);
            setCurrentStatus(res.data.new_status)
        } else {
            NotificationManager.error("Error", `${res.err}`, 5000)
        }

    }

    const duplicateColumns = [
        {label: "Symbol", accessor: "symbol", sortable: true, sortbyOrder: "asc", cellType: "display"},
        {label: "Name", accessor: "name", sortable: true, cellType: "display"},
        {label: "CG ID", accessor: "coingeckoCoinId", sortable: true, cellType: "cgcoin"},
        {label: "Tx Count", accessor: "txCount", sortable: true, cellType: "number"},
        {label: "Market Cap USD", accessor: "marketCapUsd", sortable: true, cellType: "usd"},
        {label: "24h Volume", accessor: "volume24hUsd", sortable: true, cellType: "usd"},
        {label: "Status", accessor: "status", sortable: true, cellType: "status"},
        { label: "", accessor: "id", sortable: false, cellType: "edit_link", meta: {url: "/t/__ID__", text: "View/Edit"} },
    ];

    const similarTokensColumns = [
        {label: "Chain", accessor: "chain", sortable: true, sortbyOrder: "asc", cellType: "display"},
        ...duplicateColumns,
    ]

    const duplicateTokens = []

    if (props.token.duplicateTokenSymbols.length > 0) {
        for (let i = 0; i < props.token.duplicateTokenSymbols.length; i += 1) {
            duplicateTokens.push(props.token.duplicateTokenSymbols[i].duplicateToken)
        }
    }

    const associatedPairs = props.token.pairsToken1.concat(props.token.pairsToken0)

    const assocPairColumns = [
        {label: "Pair", accessor: "pair", sortable: true, sortbyOrder: "asc", cellType: "display"},
        {label: "Dex", accessor: "dex", sortable: true, sortbyOrder: "asc", cellType: "display"},
        {label: "Reserve USD", accessor: "reserveUsd", sortable: true, cellType: "usd"},
        {label: "Reserve Native", accessor: "reserveNativeCurrency", sortable: true, cellType: "number"},
        {label: "Tx Count", accessor: "txCount", sortable: true, cellType: "number"},
        {label: "Total Volume USD (DEX)", accessor: "volumeUsd", sortable: true, cellType: "usd"},
        {label: "Status", accessor: "status", sortable: true, cellType: "status"},
        { label: "", accessor: "id", sortable: false, cellType: "edit_link", meta: {url: "/p/__ID__", text: "View/Edit"} },
    ]

    return (
        <Layout>
            <div key={`token_page_${props.token.id}`}>
                <h1>Token</h1>
                <h3>Chain: <ChainName chain={props.token.chain}/></h3>
                <h2>Symbol: {props.token.symbol}</h2>
                <p>Name: {props.token.name}</p>
                <p>Explorer: &nbsp;
                    <ExplorerUrl chain={props.token.chain} contractAddress={props.token.contractAddress}
                                 linkType={"token"}/>
                </p>
                <p>
                    CoinGecko: <CoinGeckoCoinLink coingeckoId={props.token.coingeckoCoinId}/>
                </p>

                <p>Status: <StatusBadge status={currentStatus} method={props.token.verificationMethod}/></p>
                Change Status: <form onSubmit={onSubmit}>
                <select name="status" id="tokenstatus" defaultValue={currentStatus}>
                    <option value={TokenPairStatus.Unverified}>Unverified</option>
                    <option value={TokenPairStatus.ManualVerified}>VERIFIED</option>
                    <option value={TokenPairStatus.Duplicate}>Duplicate</option>
                    <option value={TokenPairStatus.NotCurrentlyUsable}>Fake/Bad/Not Usable</option>
                </select>
                <input type={"text"} defaultValue={props.token.verificationComment} name={"comment"} placeholder={"optional comment"} />
                <input type={"hidden"} value={props.token.id} name={"tokenid"} />
                <button type="submit">Submit</button>
            </form>

                <p><strong>Note:</strong> Setting the token status to &quot;Fake/Dupe&quot; will automatically set the status of
                    ALL
                    associated pairs to Fake/Dupe</p>

                {
                    props.token.scamCheckedAt > 0 &&
                    <>
                        <h4>Scam check (GoPlus)</h4>
                        {
                            props.token.isScamFlagged
                                ? <p style={{ color: "red", fontWeight: "bold" }}>⚠ Flagged: {props.token.scamReason}</p>
                                : <p style={{ color: "green" }}>No scam signals</p>
                        }
                        {
                            props.token.goPlusData &&
                            <table>
                                <thead>
                                    <tr><th>Signal</th><th>Value</th></tr>
                                </thead>
                                <tbody>
                                    {Object.entries(props.token.goPlusData)
                                        .filter(([, v]) => typeof v === "string" || typeof v === "number")
                                        .map(([k, v]) => (
                                            <tr key={`gp_${k}`}><td>{k}</td><td>{String(v)}</td></tr>
                                        ))}
                                </tbody>
                            </table>
                        }
                    </>
                }

                <h4>Stats</h4>
                <table>
                    <thead>
                    <tr>
                        <th>Tx Count</th>
                        <th>Market Cap</th>
                        <th>Total Supply</th>
                        <th>24h Volume</th>
                    </tr>
                    </thead>
                    <tbody>
                    <tr>
                        <td>
                            <NumericFormat displayType="text" thousandSeparator="," decimalScale={2} value={props.token.txCount}/>
                        </td>
                        <td>
                            $<NumericFormat displayType="text" thousandSeparator="," decimalScale={2} value={props.token.marketCapUsd}/>
                        </td>
                        <td>
                            <NumericFormat displayType="text" thousandSeparator="," decimalScale={2}
                                           value={props.token.totalSupply / (10 ** props.token.decimals)}/>
                        </td>
                        <td>
                            $<NumericFormat displayType="text" thousandSeparator="," decimalScale={2} value={props.token.volume24hUsd}/>
                        </td>
                    </tr>
                    </tbody>
                </table>

                {
                    (duplicateTokens.length) > 0 &&
                    <>
                        <h4>Possible Duplicates on this chain ({props.token.chain})</h4>
                        <SortableTable
                            key={`duplicatetoken_list_${props.token.id}`}
                            caption=""
                            data={duplicateTokens}
                            columns={duplicateColumns}
                            useFilter={true}
                        />
                    </>
                }

                {
                    (props.similarTokens.length) > 0 &&
                    <>
                        <h4>Similar Tokens on other chains</h4>
                        <SortableTable
                            key={`similartoken_list_${props.token.id}`}
                            caption=""
                            data={props.similarTokens}
                            columns={similarTokensColumns}
                            useFilter={true}
                        />
                    </>
                }

                <h4>Associated Pairs</h4>

                <SortableTable
                    key={`associated_pairs_list_${props.token.id}`}
                    caption=""
                    data={associatedPairs}
                    columns={assocPairColumns}
                    useFilter={true}
                />
            </div>
        </Layout>
    )
}

export default Token;
