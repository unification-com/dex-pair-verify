import { GetServerSideProps } from "next";
import Link from "next/link";
import React from "react";

import ThresholdPriceTest from "../../../components/PriceTest/ThresholdPriceTest";
import Layout from "../../../components/shell/Layout";
import PageHeader from "../../../components/ui/PageHeader";
import { isOperatorCtx } from "../../../lib/operatorGate";
import prisma from "../../../lib/prisma";
import { priceTestPairSelect } from "../../../lib/publicSelect";
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
    // Price-test only needs market facts + pool/token ids — never verdict internals.
    select: priceTestPairSelect,
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

// PairNotSupported is the empty state when a symbol pair has no verified pools backing
// it - the oracle has nothing to price, so we say so plainly rather than rendering a
// misleading "= 0" headline from an empty sample set.
const PairNotSupported: React.FC<{ base: string; target: string }> = ({ base, target }) => (
  <>
    <PageHeader
      title={<>OoO price-test <span className="mono">{base}→{target}</span></>}
      sub="Simulate the oracle price for a verified pair across every backing pool."
    />
    <div className="card card-pad" style={{ maxWidth: 640 }}>
      <h3 style={{ marginTop: 0 }}>Pair not supported yet</h3>
      <p className="muted">
        <span className="mono">{base}→{target}</span> has no verified pools in dex-pair-verify,
        so the oracle can&apos;t price it yet. A pair becomes priceable once at least one of its
        pools passes verification.
      </p>
      <div style={{ display: "flex", gap: "var(--sp-3)", marginTop: "var(--sp-4)", flexWrap: "wrap" }}>
        <Link href="/price-test"><a className="btn btn-ghost btn-sm">← Try another pair</a></Link>
        <Link href="/pairs"><a className="btn btn-ghost btn-sm">Browse verified pairs</a></Link>
      </div>
    </div>
  </>
);

const BaseTargetTestPage: React.FC<Props> = (props) => {
  return (
    <Layout>
      {props.pairs.length > 0 ? (
        <ThresholdPriceTest
          base={props.base}
          target={props.target}
          pairs={props.pairs}
          thresholds={props.thresholds}
          isPublic={props.isPublic}
        />
      ) : (
        <PairNotSupported base={props.base} target={props.target} />
      )}
    </Layout>
  );
};

export default BaseTargetTestPage;
