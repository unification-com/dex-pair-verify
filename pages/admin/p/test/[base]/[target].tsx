import { GetServerSideProps } from "next";
import React from "react";

import ThresholdPriceTest from "../../../../../components/PriceTest/ThresholdPriceTest";
import Layout from "../../../../../components/shell/Layout";
import prisma from "../../../../../lib/prisma";
import { VERIFIED_STATUSES } from "../../../../../lib/status";
import { buildThresholdMap, ThresholdMap } from "../../../../../lib/thresholds";
import { PairProps } from "../../../../../types/props";

export const getServerSideProps: GetServerSideProps = async ({ params }) => {
  const base = String(params?.base);
  const target = String(params?.target);

  const pairs = await prisma.pair.findMany({
    where: {
      OR: [{ pair: `${base}-${target}` }, { pair: `${target}-${base}` }],
      status: { in: [...VERIFIED_STATUSES] },
    },
  });

  const thresholds = await buildThresholdMap(pairs);

  return {
    props: { base, target, pairs, thresholds },
  };
};

type Props = {
  base: string;
  target: string;
  pairs: PairProps[];
  thresholds: ThresholdMap;
};

const BaseTargetTestPage: React.FC<Props> = (props) => {
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

export default BaseTargetTestPage;
