import React from "react"
import { GetStaticProps } from "next"
import Layout from "../components/Layout"
import prisma from '../lib/prisma';
import Link from "next/link";

export const getStaticProps: GetStaticProps = async () => {
  const feed = await prisma.pair.findMany({
    distinct: ['chain', 'dex'],
  });
  return {
    props: { feed },
    revalidate: 10,
  };
}

type Props = {
  feed: any
}

const Blog: React.FC<Props> = (props) => {
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
              <th></th>
              <th></th>
            </tr>
            </thead>
            <tbody>
          {props.feed.map((pair) => (
              <tr key={pair.id}>
                <td>
                  {pair.chain}
                </td>
                <td>
                  {pair.dex}
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

export default Blog
