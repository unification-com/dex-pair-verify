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

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()

        const formData = new FormData(event.currentTarget)
        const response = await fetch('/api/settokenstatus', {
            method: 'POST',
            body: formData,
        })

        // Handle response if necessary
        const res = await response.json()
        if(res.success) {
            NotificationManager.success("Success!", `Status changed to ${res.data.new_status}`, 5000);
            setCurrentStatus(res.data.new_status)
        } else {
            NotificationManager.error("Error", `${res.err}`, 5000)
        }

    }

    const columns = [
        { label: "Symbol", accessor: "symbol", sortable: true, sortbyOrder: "asc", cellType: "display" },
        { label: "Name", accessor: "name", sortable: true, cellType: "display" },
        { label: "Tx Count", accessor: "txCount", sortable: true, cellType: "number" },
        { label: "Market Cap USD", accessor: "marketCapUsd", sortable: true, cellType: "usd" },
        { label: "24h Volume", accessor: "volume24hUsd", sortable: true, cellType: "usd" },
        { label: "Status", accessor: "status", sortable: true, cellType: "status" },
        { label: "Edit", accessor: "id", sortable: false, cellType: "edit_button", router: {url: "/t/[id]", as: "/t/__ID__"} },
    ];

    const duplicateTokens = []

    if(props.token.duplicateTokenSymbols.length > 0) {
        for(let i = 0; i < props.token.duplicateTokenSymbols.length; i += 1) {
            duplicateTokens.push(props.token.duplicateTokenSymbols[i].duplicateToken)
        }
    }

    return (
        <Layout>
            <div>
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
                <select name="status" id="tokenstatus">
                    <option value="0">Unverified</option>
                    <option value="1">VERIFIED</option>
                    <option value="2">Duplicate</option>
                    <option value="3">Fake/Bad/Not Usable</option>
                </select>
                <input type={"hidden"} value={props.token.id} name={"tokenid"}/>
                <button type="submit">Submit</button>
            </form>

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
                            <NumericFormat displayType="text" thousandSeparator="," value={props.token.txCount}/>
                        </td>
                        <td>
                            $<NumericFormat displayType="text" thousandSeparator="," value={props.token.marketCapUsd}/>
                        </td>
                        <td>
                            <NumericFormat displayType="text" thousandSeparator=","
                                           value={props.token.totalSupply / (10 ** props.token.decimals)}/>
                        </td>
                        <td>
                            $<NumericFormat displayType="text" thousandSeparator="," value={props.token.volume24hUsd}/>
                        </td>
                    </tr>
                    </tbody>
                </table>

                <p><strong>Note:</strong> Setting the token status to "Fake/Dupe" will automatically set the status of
                    ALL
                    associated pairs to Fake/Dupe</p>

                {
                    (duplicateTokens.length) > 0 &&
                    <>
                        <h4>Possible Duplicates</h4>
                        <SortableTable
                            key={`duplicatetoken_list_${props.token.id}`}
                            caption=""
                            data={duplicateTokens}
                            columns={columns}
                        />
                    </>
                }

                <h4>Associated Pairs</h4>

                <table>
                    <thead>
                    <tr>
                        <th>Pair</th>
                        <th>Reserve USD</th>
                        <th>Reserve Native</th>
                        <th>Tx Count</th>
                        <th>Total Volume USD</th>
                        <th>Status</th>
                    </tr>
                    </thead>
                    <tbody>
                    {props.token.pairsToken0 && props.token.pairsToken0.map((pairToken0) => (
                        <tr key={pairToken0.id}>
                            <td>
                                <Link
                                    href={`/p/${pairToken0.id}`}>
                                    {pairToken0.pair}
                                </Link>
                            </td>
                            <td>
                                $<NumericFormat displayType="text" thousandSeparator="," value={pairToken0.reserveUsd}/>
                            </td>
                            <td>
                                <NumericFormat displayType="text" thousandSeparator=","
                                               value={pairToken0.reserveNativeCurrency}/>
                            </td>
                            <td>
                                <NumericFormat displayType="text" thousandSeparator=","
                                               value={pairToken0.txCount}/>
                            </td>
                            <td>
                                $<NumericFormat displayType="text" thousandSeparator="," value={pairToken0.volumeUsd}/>
                            </td>
                            <td>
                                <Status status={pairToken0.status} method={""}/>
                            </td>
                        </tr>
                    ))}
                    {props.token.pairsToken1 && props.token.pairsToken1.map((pairToken1) => (
                        <tr key={pairToken1.id}>
                            <td>
                                <Link
                                    href={`/p/${pairToken1.id}`}>
                                    {pairToken1.pair}
                                </Link>
                            </td>
                            <td>
                                $<NumericFormat displayType="text" thousandSeparator="," value={pairToken1.reserveUsd}/>
                            </td>
                            <td>
                                <NumericFormat displayType="text" thousandSeparator=","
                                               value={pairToken1.reserveNativeCurrency}/>
                            </td>
                            <td>
                                <NumericFormat displayType="text" thousandSeparator=","
                                               value={pairToken1.txCount}/>
                            </td>
                            <td>
                                $<NumericFormat displayType="text" thousandSeparator="," value={pairToken1.volumeUsd}/>
                            </td>
                            <td>
                                <Status status={pairToken1.status} method={""}/>
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>

            </div>
        </Layout>
    )
}

export default Token;
