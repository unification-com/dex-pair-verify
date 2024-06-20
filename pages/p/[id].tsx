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


export const getServerSideProps: GetServerSideProps = async ({ params }) => {

  const pair = await prisma.pair.findUnique({
    where: {
      id: String(params?.id),
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

  const duplicates = await prisma.pair.findMany({
    where: {
      chain: pair.chain,
      dex: pair.dex,
      id: {
        not: pair.id,
      },
      OR: [
        {
          pair: `${pair.token0.symbol}-${pair.token1.symbol}`,
        },
        {
          pair: `${pair.token1.symbol}-${pair.token0.symbol}`,
        },
      ],
    },
  });

  return {
    props: {pair, duplicates},
  }
}

type Props = {
  pair: PairProps;
  duplicates: PairPropsNoToken[];
}

const Pair: React.FC<Props> = (props) => {

  const [currentStatus, setCurrentStatus] = useState(props.pair.status)

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

  let verifyPair = null;

  if(props.pair.token0.status !== 0 && props.pair.token1.status !== 0) {

    let verifyOpts = null
    if(props.pair.token0.status === 1 && props.pair.token1.status === 1) {
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
      <input type={"hidden"} value={props.pair.id} name={"pairid"}/>
      <button type="submit">Submit</button>
    </form>
  }

  return (
      <Layout>
        <div>
          <h1>Pair</h1>
          <h2><DexName dex={props.pair.dex}/> (<ChainName chain={props.pair.chain}/>)</h2>
          <h3>
            {props.pair.pair} <br/>
            Pool Analytics: <PoolUrl chain={props.pair.chain} dex={props.pair.dex} contractAddress={props.pair.contractAddress}/><br/>
            Explorer: <ExplorerUrl chain={props.pair.chain} contractAddress={props.pair.contractAddress} linkType={"address"}/>
          </h3>

          <h4>Pair Status: <Status status={currentStatus}/>
            {verifyPair}
          </h4>

          <p>
            Reserve USD: $<NumericFormat displayType="text" thousandSeparator="," value={props.pair.reserveUsd}/>
          </p>
          <p>
            Reserve Native: <NumericFormat displayType="text" thousandSeparator=","
                                           value={props.pair.reserveNativeCurrency}/> <NativeToken chain={props.pair.chain}/>
          </p>
          <p>
            Reserve Token 0: <NumericFormat displayType="text" thousandSeparator=","
                                            value={props.pair.reserve0}/> {props.pair.token0.symbol}
          </p>
          <p>
            Reserve Token 1: <NumericFormat displayType="text" thousandSeparator=","
                                            value={props.pair.reserve1}/> {props.pair.token1.symbol}
          </p>
          <p>
            Volume USD: <NumericFormat displayType="text" thousandSeparator="," value={props.pair.volumeUsd}/>
          </p>
          <p>
            Tx Count: <NumericFormat displayType="text" thousandSeparator="," value={props.pair.txCount}/>
          </p>

          <h4>Token 0</h4>
          <p>Symbol: {props.pair.token0.symbol}</p>
          <p>Explorer: &nbsp;
            <ExplorerUrl chain={props.pair.chain} contractAddress={props.pair.token0.contractAddress} linkType={"token"}/>
          </p>
          <p>
            Tx Count: <NumericFormat displayType="text" thousandSeparator="," value={props.pair.token0.txCount}/>
          </p>

          <p>Status: <Status status={props.pair.token0.status}/>&nbsp;
            <button onClick={() => Router.push("/t/[id]", `/t/${props.pair.token0.id}`)}>
              <strong>Edit Token</strong>
            </button>
          </p>

          <h4>Token 1</h4>
          <p>Symbol: {props.pair.token1.symbol}</p>
          <p>Explorer: &nbsp;
            <ExplorerUrl chain={props.pair.chain} contractAddress={props.pair.token0.contractAddress} linkType={"token"}/>
          </p>
          <p>
            Tx Count: <NumericFormat displayType="text" thousandSeparator="," value={props.pair.token1.txCount}/>
          </p>

          <p>Status: <Status status={props.pair.token1.status}/>&nbsp;
            <button onClick={() => Router.push("/t/[id]", `/t/${props.pair.token1.id}`)}>
              <strong>Edit Token</strong>
            </button>
          </p>

          {
              (props.duplicates.length) > 0 &&
              <>
                <h4>Possible Duplicates</h4>
                <ul>
                  {props.duplicates.map((dupe) => (
                      <>
                        <li key={dupe.id}>
                          <Link
                              href={`/p/${dupe.id}`}>
                            {dupe.pair}
                          </Link>
                        </li>
                      </>
                  ))}
                </ul>
              </>
          }

        </div>

      </Layout>
  )
}

export default Pair
