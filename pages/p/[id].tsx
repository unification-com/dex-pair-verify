import React, {FormEvent, useState} from "react"
import { GetServerSideProps } from "next"
import Layout from "../../components/Layout"
import prisma from '../../lib/prisma';
import Router from "next/router";
import {NotificationManager} from 'react-notifications';
import { NumericFormat } from 'react-number-format';
import Status from "../../components/Status";
import {PairProps, PairPropsNoToken} from "../../types/props";
import PoolUrl from "../../components/PoolUrl";
import ExplorerUrl from "../../components/ExplorerUrl";
import ChainName from "../../components/ChainName";
import DexName from "../../components/DexName";
import NativeToken from "../../components/NativeToken";
import Link from "next/link";
import CoinGeckoPoolLink from "../../components/CoinGeckoPoolLink";
import SortableTable from "../../components/SortableTable/SortableTable";
import CoinGeckoCoinLink from "../../components/CoinGeckoCoinLink";


export const getServerSideProps: GetServerSideProps = async ({ params }) => {

  const pair = await prisma.pair.findUnique({
    where: {
      id: String(params?.id),
    },
    include: {
      token0: {
        select: { symbol: true, id: true, contractAddress: true, txCount: true, status: true, coingeckoCoinId: true },
      },
      token1: {
        select: { symbol: true, id: true, contractAddress: true, txCount: true, status: true, coingeckoCoinId: true },
      },
      duplicatePairs: {
        select: {
          duplicatePair: true,
        }
      },
    },
  });

  const similarPairs = await prisma.pair.findMany({
    where: {
      OR: [
        {
          pair: `${pair.token0.symbol}-${pair.token1.symbol}`,
        },
        {
          pair: `${pair.token1.symbol}-${pair.token0.symbol}`,
        }
      ],
      NOT: {
        chain: pair.chain,
        dex: pair.dex,
      }
    },
    include: {
      token0: {
        select: { symbol: true, id: true, contractAddress: true, txCount: true, status: true },
      },
      token1: {
        select: { symbol: true, id: true, contractAddress: true, txCount: true, status: true },
      },
    },
  });


  return {
    props: {pair, similarPairs},
  }
}

type Props = {
  pair: PairProps;
  similarPairs: PairProps[];
}

const Pair: React.FC<Props> = (props) => {

  const [currentStatus, setCurrentStatus] = useState(props.pair.status)

  if(currentStatus !== props.pair.status) {
    setCurrentStatus(props.pair.status)
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const response = await fetch('/api/setpairstatus', {
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
    { label: "Pair", accessor: "pair", sortable: true, sortbyOrder: "asc", cellType: "display" },
    { label: "Tx Count", accessor: "txCount", sortable: true, cellType: "number" },
    { label: "Market Cap USD", accessor: "marketCapUsd", sortable: true, cellType: "usd" },
    { label: "24h Volume", accessor: "volumeUsd24h", sortable: true, cellType: "usd" },
    { label: "24h Price Change", accessor: "priceChangePercentage24h", sortable: true, cellType: "percent" },
    { label: "# Buys (24h)", accessor: "buys24h", sortable: true, cellType: "number" },
    { label: "# Buyers (24h)", accessor: "buyers24h", sortable: true, cellType: "number" },
    { label: "# Sells (24h)", accessor: "sells24h", sortable: true, cellType: "number" },
    { label: "# Sellers (24h)", accessor: "sellers24h", sortable: true, cellType: "number" },
    { label: "Status", accessor: "status", sortable: true, cellType: "status" },
    { label: "Edit", accessor: "id", sortable: false, cellType: "edit_link", meta: {url: "/p/__ID__", text: "View/Edit"} },
  ];

  const similarPairsColumns = [
    { label: "Chain", accessor: "chain", sortable: true, sortbyOrder: "asc", cellType: "display" },
    { label: "Dex", accessor: "dex", sortable: true, sortbyOrder: "asc", cellType: "display" },
    { label: "Pair", accessor: "pair", sortable: true, sortbyOrder: "asc", cellType: "display" },
    { label: "Tx Count", accessor: "txCount", sortable: true, cellType: "number" },
    { label: "Market Cap USD", accessor: "marketCapUsd", sortable: true, cellType: "usd" },
    { label: "24h Volume", accessor: "volumeUsd24h", sortable: true, cellType: "usd" },
    { label: "# Buys (24h)", accessor: "buys24h", sortable: true, cellType: "number" },
    { label: "# Buyers (24h)", accessor: "buyers24h", sortable: true, cellType: "number" },
    { label: "# Sells (24h)", accessor: "sells24h", sortable: true, cellType: "number" },
    { label: "# Sellers (24h)", accessor: "sellers24h", sortable: true, cellType: "number" },
    { label: "Status", accessor: "status", sortable: true, cellType: "status" },
    { label: "Edit", accessor: "id", sortable: false, cellType: "edit_link", meta: {url: "/p/__ID__", text: "View/Edit"} },
  ];

  const duplicatePairs = []

  if(props.pair.duplicatePairs.length > 0) {
    for(let i = 0; i < props.pair.duplicatePairs.length; i += 1) {
      duplicatePairs.push(props.pair.duplicatePairs[i].duplicatePair)
    }
  }


  let verifyPair = null;
  let verifyOpts = null
  if(props.pair.token0.status === 1 && props.pair.token1.status === 1) {
    verifyOpts = <>
      <option value="0">Unverified</option>
      <option value="1">VERIFIED</option>
      <option value="2">Duplicate</option>
      <option value="3">Fake/Bad/Not Usable</option>
    </>
  } else {
    verifyOpts = <>
      <option value="0">Unverified</option>
      <option value="1" disabled={true}>VERIFIED</option>
      <option value="2">Duplicate</option>
      <option value="3">Fake/Bad/Not Usable</option>
    </>
  }

  verifyPair = <form onSubmit={onSubmit}>
    <select name="status" id="pairstatus" defaultValue={currentStatus}>
      {verifyOpts}
    </select>
    <input type={"text"} defaultValue={props.pair.verificationComment} name={"comment"} placeholder={"optional comment"} />
    <input type={"hidden"} value={props.pair.id} name={"pairid"} />
    <button type="submit">Submit</button>
  </form>


  return (
      <Layout>
        <div key={`token_page_${props.pair.id}`}>
        <h1>Pair</h1>
          <h2><DexName dex={props.pair.dex}/> (<ChainName chain={props.pair.chain}/>)</h2>
          <h3>
            {props.pair.pair} <br/>
            CoinGecko: <CoinGeckoPoolLink chain={props.pair.chain} contractAddress={props.pair.contractAddress}/><br/>
            DEX Analytics: <PoolUrl chain={props.pair.chain} dex={props.pair.dex}
                                    contractAddress={props.pair.contractAddress}/><br/>
            Explorer: <ExplorerUrl chain={props.pair.chain} contractAddress={props.pair.contractAddress}
                                   linkType={"address"}/>
          </h3>

          <h4>Pair Status: <Status status={currentStatus} method={props.pair.verificationMethod}/>
            {verifyPair}
          </h4>


          <h4>Data from CoinGecko API</h4>

          <table>
            <thead>
            <tr>
              <th>Market Cap</th>
              <th>{props.pair.token0.symbol} Price</th>
              <th>{props.pair.token1.symbol} Price</th>
              <th>24h Change</th>
              <th># Buys (24h)</th>
              <th># Buyers (24h)</th>
              <th># Sells (24h)</th>
              <th># Sellers (24h)</th>
              <th>24h Volume</th>
            </tr>
            </thead>
            <tbody>
            <tr>
              <td>
                $<NumericFormat displayType="text" thousandSeparator="," decimalScale={2}
                                value={props.pair.marketCapUsd}/>
              </td>
              <td>
                <NumericFormat displayType="text" thousandSeparator="," decimalScale={2}
                               value={props.pair.token0PriceCg}/>
                &nbsp;
                {props.pair.token1.symbol}
              </td>
              <td>
                <NumericFormat displayType="text" thousandSeparator="," decimalScale={2}
                               value={props.pair.token1PriceCg}/>
                &nbsp;
                {props.pair.token0.symbol}
              </td>
              <td>
                <NumericFormat displayType="text" thousandSeparator="," decimalScale={2}
                               value={props.pair.priceChangePercentage24h}/>%
              </td>
              <td>
                <NumericFormat displayType="text" thousandSeparator="," decimalScale={2}
                               value={props.pair.buys24h}/>
              </td>
              <td>
                <NumericFormat displayType="text" thousandSeparator="," decimalScale={2} value={props.pair.buyers24h}/>
              </td>
              <td>
                <NumericFormat displayType="text" thousandSeparator="," decimalScale={2}
                               value={props.pair.sells24h}/>
              </td>
              <td>
                <NumericFormat displayType="text" thousandSeparator="," decimalScale={2} value={props.pair.sellers24h}/>
              </td>
              <td>
                $<NumericFormat displayType="text" thousandSeparator="," decimalScale={2}
                                value={props.pair.volumeUsd24h}/>
              </td>
            </tr>
            </tbody>
          </table>

          <h4>Data from DEX Subgraph</h4>

          <table>
            <thead>
            <tr>
              <th>Reserve USD</th>
              <th>Reserve Native</th>
              <th>Reserve Token 0</th>
              <th>Reserve Token 1</th>
              <th>Volume USD</th>
              <th>Tx Count</th>
            </tr>
            </thead>
            <tbody>
            <tr>
              <td>
              $<NumericFormat displayType="text" thousandSeparator="," decimalScale={2}
                                value={props.pair.reserveUsd}/>
              </td>
              <td>
                <NumericFormat displayType="text" thousandSeparator="," decimalScale={2}
                               value={props.pair.reserveNativeCurrency}/> <NativeToken
                  chain={props.pair.chain}/>
              </td>
              <td>
                <NumericFormat displayType="text" thousandSeparator="," decimalScale={2}
                               value={props.pair.reserve0}/> {props.pair.token0.symbol}
              </td>
              <td>
                <NumericFormat displayType="text" thousandSeparator="," decimalScale={2}
                               value={props.pair.reserve1}/> {props.pair.token1.symbol}
              </td>
              <td>
                <NumericFormat displayType="text" thousandSeparator="," decimalScale={2} value={props.pair.volumeUsd}/>
              </td>
              <td>
                <NumericFormat displayType="text" thousandSeparator="," decimalScale={2} value={props.pair.txCount}/>
              </td>
            </tr>
            </tbody>
          </table>

          <h4>Token 0</h4>
          <p>Symbol: {props.pair.token0.symbol}</p>
          <p>Explorer: &nbsp;
            <ExplorerUrl chain={props.pair.chain} contractAddress={props.pair.token0.contractAddress}
                         linkType={"token"}/>
          </p>
          <p>Coin Gecko: <CoinGeckoCoinLink coingeckoId={props.pair.token0.coingeckoCoinId}/></p>
          <p>
            Tx Count: <NumericFormat displayType="text" thousandSeparator="," decimalScale={2}
                                     value={props.pair.token0.txCount}/>
          </p>

          <p>Status: <Status status={props.pair.token0.status} method={""}/>&nbsp;
            <Link
                href={`/t/${props.pair.token0.id}`}>
              <a>View/Edit</a>
            </Link>
          </p>

          <h4>Token 1</h4>
          <p>Symbol: {props.pair.token1.symbol}</p>
          <p>Explorer: &nbsp;
            <ExplorerUrl chain={props.pair.chain} contractAddress={props.pair.token1.contractAddress}
                         linkType={"token"}/>
          </p>
          <p>Coin Gecko: <CoinGeckoCoinLink coingeckoId={props.pair.token1.coingeckoCoinId}/></p>
          <p>
            Tx Count: <NumericFormat displayType="text" thousandSeparator="," decimalScale={2}
                                     value={props.pair.token1.txCount}/>
          </p>

          <p>Status: <Status status={props.pair.token1.status} method={""}/>&nbsp;
            <Link
                href={`/t/${props.pair.token1.id}`}>
              <a>View/Edit</a>
            </Link>
          </p>

          {
              (duplicatePairs.length) > 0 &&
              <>
                <h4>Possible Duplicates on this DEX ({props.pair.dex})</h4>
                <SortableTable
                    key={`duplicatepair_list_${props.pair.id}`}
                    caption=""
                    data={duplicatePairs}
                    columns={columns}
                />
              </>
          }

          {
              (props.similarPairs.length) > 0 &&
              <>
                <h4>Similar pairs on other DEXs</h4>
                <SortableTable
                    key={`similarpair_list_${props.pair.id}`}
                    caption=""
                    data={props.similarPairs}
                    columns={similarPairsColumns}
                />
              </>
          }

        </div>

      </Layout>
  )
}

export default Pair
