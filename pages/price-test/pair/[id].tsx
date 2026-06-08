import { GetServerSideProps } from "next";
import React from "react";

import ThresholdPriceTest from "../../../components/PriceTest/ThresholdPriceTest";
import Layout from "../../../components/shell/Layout";
import StatusBadge from "../../../components/ui/StatusBadge";
import { isOperatorCtx } from "../../../lib/operatorGate";
import prisma from "../../../lib/prisma";
import { isVerifiedStatus, VERIFIED_STATUSES } from "../../../lib/status";
import { buildThresholdMap, ThresholdMap } from "../../../lib/thresholds";
import { PairProps } from "../../../types/props";
import { TokenPairStatus } from "../../../types/types";

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const operator = await isOperatorCtx(ctx);
  const { params } = ctx;
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

  if (pair === null) {
    return { notFound: true };
  }
  // Public visitors can only price-test verified pairs — 404 anything else (don't
  // leak an unverified pair's status). Operators see the "try another" message.
  if (!operator && !isVerifiedStatus(pair.status as TokenPairStatus)) {
    return { notFound: true };
  }

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
    props: { pair, base: pair.token0.symbol, target: pair.token1.symbol, pairs, thresholds, isPublic: !operator },
  };
};

type Props = {
  pair: PairProps;
  base: string;
  target: string;
  pairs: PairProps[];
  thresholds: ThresholdMap;
  isPublic: boolean;
};

const PairTestPage: React.FC<Props> = (props) => {
  if (!isVerifiedStatus(props.pair.status)) {
    return (
      <Layout>
        <h3>
          Pair &quot;{props.pair.pair}&quot; status is{" "}
          <StatusBadge status={props.pair.status} method={""} />. Please try another
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
        isPublic={props.isPublic}
      />
    </Layout>
  );
};

export default PairTestPage;
