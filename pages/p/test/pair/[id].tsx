import { GetServerSideProps } from "next";
import React from "react";

import Layout from "../../../../components/Layout";
import ThresholdPriceTest from "../../../../components/PriceTest/ThresholdPriceTest";
import Status from "../../../../components/Status";
import prisma from "../../../../lib/prisma";
import { isVerifiedStatus, VERIFIED_STATUSES } from "../../../../lib/status";
import { buildThresholdMap, ThresholdMap } from "../../../../lib/thresholds";
import { PairProps } from "../../../../types/props";

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
    },
  });

  const pairs = await prisma.pair.findMany({
    where: {
      OR: [
        { pair: `${pair.token0.symbol}-${pair.token1.symbol}` },
        { pair: `${pair.token1.symbol}-${pair.token0.symbol}` },
      ],
      status: { in: [...VERIFIED_STATUSES] },
    },
  });

  const thresholds = await buildThresholdMap(pairs);

  return {
    props: { pair, base: pair.token0.symbol, target: pair.token1.symbol, pairs, thresholds },
  };
};

type Props = {
  pair: PairProps;
  base: string;
  target: string;
  pairs: PairProps[];
  thresholds: ThresholdMap;
};

const PairTestPage: React.FC<Props> = (props) => {
  if (!isVerifiedStatus(props.pair.status)) {
    return (
      <Layout>
        <h3>
          Pair &quot;{props.pair.pair}&quot; status is{" "}
          <Status status={props.pair.status} method={""} />. Please try another
        </h3>
      </Layout>
    );
  }

  return (
    <Layout>
      <ThresholdPriceTest
        base={props.base}
        target={props.target}
        pairs={props.pairs}
        thresholds={props.thresholds}
      />
    </Layout>
  );
};

export default PairTestPage;
