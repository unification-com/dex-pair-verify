// Splits the verified pools for a (base, target) into usable / ignored by the
// saved per-(chain,dex) thresholds, then renders the price test. Thresholds are
// tuned on /thresholds (single source of truth — no duplicate editor here).
import React, { useEffect, useState } from "react";

import PriceTest from "./PriceTest";
import { ThresholdMap } from "../../lib/thresholds";
import { PairProps } from "../../types/props";

type Props = {
  base: string;
  target: string;
  pairs: PairProps[];
  thresholds: ThresholdMap;
  isPublic?: boolean;
};

const ThresholdPriceTest: React.FC<Props> = (props) => {
  const [usablePairs, setUsablePairs] = useState<PairProps[]>([]);
  const [ignoredPairs, setIgnoredPairs] = useState<PairProps[]>([]);

  useEffect(() => {
    const up: PairProps[] = [];
    const ip: PairProps[] = [];
    for (const p of props.pairs) {
      const t = props.thresholds[p.chain]?.[p.dex];
      if (t && p.reserveUsd >= t.minReserveUsd && p.txCount >= t.minTxCount) {
        up.push(p);
      } else {
        ip.push(p);
      }
    }
    setUsablePairs(up);
    setIgnoredPairs(ip);
  }, [props.thresholds, props.pairs]);

  return (
    <PriceTest
      key={`price_test_${props.base}_${props.target}`}
      base={props.base}
      target={props.target}
      usablePairs={usablePairs}
      ignoredPairs={ignoredPairs}
      isPublic={props.isPublic}
    />
  );
};

export default ThresholdPriceTest;
