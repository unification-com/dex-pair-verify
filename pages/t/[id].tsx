import React, {FormEvent, useState} from "react"
import { GetServerSideProps } from "next"
import Layout from "../../components/Layout"
import prisma from '../../lib/prisma';
import Link from "next/link";

import {NotificationManager} from 'react-notifications';
import Status from "../../components/Status";
import {TokenProps} from "../../types/props";
import ChainName from "../../components/ChainName";
import ExplorerUrl from "../../components/ExplorerUrl";
import {NumericFormat} from "react-number-format";
import CoinGeckoCoinLink from "../../components/CoinGeckoCoinLink";
import SortableTable from "../../components/SortableTable/SortableTable";
import Router from "next/router";

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
                },
            },
            duplicateTokenSymbols: {
                select: {
                    duplicateToken: true,
                }
            }
        },
    });

    return {
        props: {token},
    }
}

type Props = {
    token: TokenProps;
}

const Token: React.FC<Props> = (props) => {
    const [currentStatus, setCurrentStatus] = useState(props.token.status)

    if(currentStatus !== props.token.status) {
        setCurrentStatus(props.token.status)
    }

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()

        const formData = new FormData(event.currentTarget)
        const response = await fetch('/api/settokenstatus', {
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
        {label: "Tx Count", accessor: "txCount", sortable: true, cellType: "number"},
        {label: "Market Cap USD", accessor: "marketCapUsd", sortable: true, cellType: "usd"},
        {label: "24h Volume", accessor: "volume24hUsd", sortable: true, cellType: "usd"},
        {label: "Status", accessor: "status", sortable: true, cellType: "status"},
        { label: "", accessor: "id", sortable: false, cellType: "edit_link", meta: {url: "/t/__ID__", text: "View/Edit"} },
    ];

    const duplicateTokens = []

    if (props.token.duplicateTokenSymbols.length > 0) {
        for (let i = 0; i < props.token.duplicateTokenSymbols.length; i += 1) {
            duplicateTokens.push(props.token.duplicateTokenSymbols[i].duplicateToken)
        }
    }

    const associatedPairs = props.token.pairsToken1.concat(props.token.pairsToken0)

    const assocPairColumns = [
        {label: "Pair", accessor: "pair", sortable: true, sortbyOrder: "asc", cellType: "display"},
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

                <p>Status: <Status status={currentStatus} method={props.token.verificationMethod}/></p>
                Change Status: <form onSubmit={onSubmit}>
                <select name="status" id="tokenstatus" defaultValue={currentStatus}>
                    <option value="0">Unverified</option>
                    <option value="1">VERIFIED</option>
                    <option value="2">Duplicate</option>
                    <option value="3">Fake/Bad/Not Usable</option>
                </select>
                <input type={"hidden"} value={props.token.id} name={"tokenid"}/>
                <button type="submit">Submit</button>
            </form>

                <p><strong>Note:</strong> Setting the token status to "Fake/Dupe" will automatically set the status of
                    ALL
                    associated pairs to Fake/Dupe</p>

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
                        <h4>Possible Duplicates</h4>
                        <SortableTable
                            key={`duplicatetoken_list_${props.token.id}`}
                            caption=""
                            data={duplicateTokens}
                            columns={duplicateColumns}
                        />
                    </>
                }

                <h4>Associated Pairs</h4>

                <SortableTable
                    key={`associated_pairs_list_${props.token.id}`}
                    caption=""
                    data={associatedPairs}
                    columns={assocPairColumns}
                />
            </div>
        </Layout>
    )
}

export default Token;
