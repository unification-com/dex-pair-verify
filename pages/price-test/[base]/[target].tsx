import { GetServerSideProps } from "next";
import React from "react";

import ThresholdPriceTest from "../../../components/PriceTest/ThresholdPriceTest";
import Layout from "../../../components/shell/Layout";
import { isOperatorCtx } from "../../../lib/operatorGate";
import prisma from "../../../lib/prisma";
import { VERIFIED_STATUSES } from "../../../lib/status";
import { buildThresholdMap, ThresholdMap } from "../../../lib/thresholds";
import { PairProps } from "../../../types/props";

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  // Public — anyone can simulate the oracle price for a verified pair. The data is
  // verified-only either way; the only difference is the price source (public →
  // 7-day-cached /api/ooo/v1/prices, operator → live /api/admin/getprices).
  const operator = await isOperatorCtx(ctx);
  const { params } = ctx;
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
    props: { base, target, pairs, thresholds, isPublic: !operator },
  };
};

type Props = {
  base: string;
  target: string;
  pairs: PairProps[];
  thresholds: ThresholdMap;
  isPublic: boolean;
};

const BaseTargetTestPage: React.FC<Props> = (props) => {
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

export default BaseTargetTestPage;
