import React, {FormEvent, useState} from "react"
import { GetServerSideProps } from "next"
import Layout from "../../components/Layout"
import prisma from '../../lib/prisma';
import Link from "next/link";
import Router from "next/router";
import {NotificationManager} from 'react-notifications';
import Status from "../../components/Status";


export const getServerSideProps: GetServerSideProps = async ({ params }) => {

  const pair = await prisma.pair.findUnique({
    where: {
      id: String(params?.id),
    },
    include: {
      token0: {
        select: { symbol: true, id: true, contractAddress: true, status: true },
      },
      token1: {
        select: { symbol: true, id: true, contractAddress: true, status: true },
      },
    },
  });
  return {
    props: pair,
  }
}

type PairProps = {
  id: string;
  chain: string;
  dex: string;
  contractAddress: string;
  pair: string;
  token0: {
    id: string;
    symbol: string;
    contractAddress: string;
    status: number;
  } | null;
  token1: {
    id: string;
    symbol: string;
    contractAddress: string;
    status: number;
  } | null;
  reserveUsd: number;
  volumeUsd: number
  txCount: number;
  status: number;
  verificationMethod: string;
};

const Pair: React.FC<PairProps> = (props) => {

  const [currentStatus, setCurrentStatus] = useState(props.status)

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

  const poolUrls = {
    bscpancakeswap_v2: "https://pancakeswap.finance/info/v2/pairs/",
    ethshibaswap: "https://analytics.shibaswap.com/pairs/",
    ethsushiswap: "https://www.sushi.com/pool/1%3A",
    ethuniswap_v2: "https://app.uniswap.org/explore/pools/ethereum/",
    ethuniswap_v3: "https://app.uniswap.org/explore/pools/ethereum/",
    polygon_posquickswap: "https://info.quickswap.exchange/#/pair/",
    gnosishoneyswap: "https://info.honeyswap.org/#/pair/",
    xdaihoneyswap: "https://info.honeyswap.org/#/pair/",
  }

  const explorerUrls = {
    eth: "https://etherscan.io",
    bsc: "https://bscscan.com",
    polygon: "https://polygonscan.com",
    gnosis: "https://gnosis.blockscout.com",
    xdai: "https://gnosis.blockscout.com",
  }

  const chainNames = {
    eth: "Ethereum",
    bsc: "BSC",
    polygon_pos: "Polygon",
    gnosis: "Gnosis (xdai)",
    xdai: "Gnosis (xdai)"
  }

  const dexNames = {
    pancakeswap_v2: "Pancakeswap V2",
    shibaswap: "ShibaSwap",
    sushiswap: "SushiSwap",
    uniswap_v2: "Uniswap V2",
    uniswap_v3: "Uniswap V3",
    quickswap: "Quickswap",
    honeyswap: "Honeyswap",
  }

  const explorer = explorerUrls[props.chain]
  const pool = poolUrls[`${props.chain}${props.dex}`]
  const chainName = chainNames[props.chain]
  const dexName = dexNames[props.dex]

  let verifyPair = null;

  if(props.token0.status !== 0 && props.token1.status !== 0) {

    let verifyOpts = null
    if(props.token0.status === 1 && props.token1.status === 1) {
      verifyOpts = <>
        <option value="0">Unverified</option>
        <option value="1">Good</option>
        <option value="2">Bad</option>
      </>
    } else {
      verifyOpts = <>
        <option value="0">Unverified</option>
        <option value="2">Bad</option>
      </>
    }

    verifyPair = <form onSubmit={onSubmit}>
      <select name="status" id="pairstatus">
        {verifyOpts}
      </select>
      <input type={"hidden"} value={props.id} name={"pairid"}/>
      <button type="submit">Submit</button>
    </form>
  }

  return (
      <Layout>
        <div>
          <h1>Pair</h1>
          <h2>{dexName} ({chainName})</h2>
          <h3>
            {props.pair} &nbsp;
            <Link href={`${pool}${props.contractAddress}`}>
              <a target="_blank">{props.contractAddress}</a>
            </Link>
          </h3>

          <h4>Pair Status: <Status status={currentStatus}/>
            {verifyPair}
          </h4>

          <p>
            Reserve USD: {props.reserveUsd}
          </p>
          <p>
            Volume USD: {props.volumeUsd}
          </p>
          <p>
            Tx Count: {props.txCount}
          </p>

          <h4>Token 0</h4>
          <p>Symbol: {props.token0.symbol}</p>
          <p>Contract: &nbsp;
            <Link href={`${explorer}/token/${props.token0.contractAddress}`}>
              <a target="_blank">{props.token0.contractAddress}</a>
            </Link>
          </p>

          <p>Status: <Status status={props.token0.status}/>&nbsp;
            <button onClick={() => Router.push("/t/[id]", `/t/${props.token0.id}`)}>
              <strong>Edit Token</strong>
            </button>
          </p>

          <h4>Token 1</h4>
          <p>Symbol: {props.token1.symbol}</p>
          <p>Contract: &nbsp;
            <Link href={`${explorer}/token/${props.token1.contractAddress}`}>
              <a target="_blank">{props.token1.contractAddress}</a>
            </Link>
          </p>

          <p>Status: <Status status={props.token1.status}/>&nbsp;
            <button onClick={() => Router.push("/t/[id]", `/t/${props.token1.id}`)}>
              <strong>Edit Token</strong>
            </button>
          </p>

        </div>

      </Layout>
  )
}

export default Pair
