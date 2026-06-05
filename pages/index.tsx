import { GetServerSideProps } from "next"
import Link from "next/link";
import React from "react"

import ChainName from "../components/ChainName";
import DexName from "../components/DexName";
import Layout from "../components/shell/Layout"
import prisma from '../lib/prisma';

export const getServerSideProps: GetServerSideProps = async () => {
  const chainDexs = await prisma.pair.findMany({
    distinct: ['chain', 'dex'],
  });
  return {
    props: { chainDexs },
  };
}

type ChainDexRow = {
  id: string
  chain: string
  dex: string
}

type Props = {
  chainDexs: ChainDexRow[]
}

const Home: React.FC<Props> = (props) => {
  return (
    <Layout>
      <div className="page">
        <h1>Chains/DEXs</h1>
        <main>
          <table>
            <thead>
            <tr>
              <th>Chain</th>
              <th>Dex</th>
              <th>Tokens</th>
              <th>Pairs</th>
              <th>Export</th>
            </tr>
            </thead>
            <tbody>
          {props.chainDexs.map((pair) => (
              <tr key={pair.id}>
                <td>
                  <ChainName chain={pair.chain}/>
                </td>
                <td>
                  <DexName dex={pair.dex}/>
                </td>
                <td>
                  <Link
                      href={`/list-tokens?chain=${encodeURIComponent(pair.chain)}`}>
                    <a>View Tokens</a>
                  </Link>
                </td>
                <td>
                  <Link
                      href={`/list-pairs?chain=${encodeURIComponent(pair.chain)}&dex=${encodeURIComponent(pair.dex)}`}>
                    <a>View Pairs</a>
                  </Link>
                </td>
                <td>
                  <Link
                      href={`/api/ooo/export?chain=${encodeURIComponent(pair.chain)}&dex=${encodeURIComponent(pair.dex)}&download=1`}>
                    <a>Export Verified</a>
                  </Link>
                </td>
              </tr>
          ))}
            </tbody>
          </table>
        </main>
      </div>
      <style jsx>{`
        .pair {
          background: white;
          transition: box-shadow 0.1s ease-in;
        }

        .pair:hover {
          box-shadow: 1px 1px 3px #aaa;
        }

        .pair + .pair {
          margin-top: 2rem;
        }
      `}</style>
    </Layout>
  )
}

export default Home
