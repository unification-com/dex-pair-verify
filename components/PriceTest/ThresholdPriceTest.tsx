// Shared body for the two OoO price-simulation pages
// (`/p/test/pair/[id]` and `/p/test/[base]/[target]`), which were
// near-identical (the D2 dedup). Holds the editable threshold table + the
// usable/ignored split + the price test. Both pages render this with their
// own server-fetched props.

import React, { FormEvent, useEffect, useState } from "react";
import { NotificationManager } from "react-notifications";

import PriceTest from "./PriceTest";
import { ThresholdMap } from "../../lib/thresholds";
import { PairProps } from "../../types/props";
import { TokenPairStatus } from "../../types/types";
import StatusBadge from "../ui/StatusBadge";

type Props = {
  base: string;
  target: string;
  pairs: PairProps[];
  thresholds: ThresholdMap;
};

const ThresholdPriceTest: React.FC<Props> = (props) => {
  const [thresholds, setThresholds] = useState<ThresholdMap>(props.thresholds);
  const [usablePairs, setUsablePairs] = useState<PairProps[]>([]);
  const [ignoredPairs, setIgnoredPairs] = useState<PairProps[]>([]);

  useEffect(() => {
    const up: PairProps[] = [];
    const ip: PairProps[] = [];
    for (const p of props.pairs) {
      const t = thresholds[p.chain]?.[p.dex];
      if (t && p.reserveUsd >= t.minReserveUsd && p.txCount >= t.minTxCount) {
        up.push(p);
      } else {
        ip.push(p);
      }
    }
    setUsablePairs(up);
    setIgnoredPairs(ip);
  }, [thresholds, props.pairs]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.target as HTMLFormElement);

    const chain = String(formData.get("chain"));
    const dex = String(formData.get("dex"));
    const minLiq = Number(formData.get("min_liquidity"));
    const minTxC = Number(formData.get("min_tx_count"));
    const saveToDb = formData.get("save_to_db");

    setThresholds((prev) => {
      const next: ThresholdMap = { ...prev, [chain]: { ...prev[chain] } };
      next[chain][dex] = { ...next[chain][dex], minReserveUsd: minLiq, minTxCount: minTxC };
      return next;
    });

    if (saveToDb !== null) {
      const response = await fetch("/api/admin/setthresholds", {
        method: "POST",
        body: formData,
      });
      const res = await response.json();
      if (res.success) {
        NotificationManager.success(
          "Success!",
          `Min Liquidity changed to $${res.data.new_min_liquidity}, Min Tx count set to ${res.data.new_min_tx_count}`,
          5000,
        );
      } else {
        NotificationManager.error("Error", `${res.err}`, 5000);
      }
    }
  }

  const thresholdsTable = (
    <>
      Only <StatusBadge status={TokenPairStatus.ManualVerified} method={""} /> pairs are used, with a USD
      reserve and Tx Count greater or equal to the values below
      <div className={"divTable"}>
        <div className={"divTableBody"}>
          <div className={"divTableRow"}>
            <div className={"divTableCell"}><strong>Chain</strong></div>
            <div className={"divTableCell"}><strong>Dex</strong></div>
            <div className={"divTableCell"}><strong>Min Liquidity</strong></div>
            <div className={"divTableCell"}><strong>Min Tx Count</strong></div>
            <div className={"divTableCell"}><strong>Save to DB</strong></div>
            <div className={"divTableCell"}></div>
          </div>
          {Object.keys(thresholds).map((chain) =>
            Object.keys(thresholds[chain]).map((dex) => (
              <form onSubmit={onSubmit} className={"divTableRow"} key={`${chain}-${dex}`}>
                <div className={"divTableCell"}>{chain}</div>
                <div className={"divTableCell"}>{dex}</div>
                <div className={"divTableCell"}>
                  <input type={"text"} defaultValue={thresholds[chain][dex].minReserveUsd}
                         name={"min_liquidity"} placeholder={"Minimum Liquidity"} size={9} />
                </div>
                <div className={"divTableCell"}>
                  <input type={"text"} defaultValue={thresholds[chain][dex].minTxCount}
                         name={"min_tx_count"} placeholder={"Minimum Tx Count"} size={5} />
                </div>
                <div className={"divTableCell"}>
                  <input type={"checkbox"} defaultValue={1} name={"save_to_db"} />
                </div>
                <div className={"divTableCell"}>
                  <input type={"hidden"} value={chain} name={"chain"} />
                  <input type={"hidden"} value={dex} name={"dex"} />
                  <input type={"hidden"} value={thresholds[chain][dex].id} name={"thresholdid"} />
                  <button type="submit">Save</button>
                </div>
              </form>
            )),
          )}
        </div>
      </div>
    </>
  );

  const noUsablePairsWarning =
    usablePairs.length === 0 ? (
      <h2>
        No usable <StatusBadge status={TokenPairStatus.ManualVerified} method={""} /> pairs found for{" "}
        {props.base}-{props.target} using specified min USD reserve and Tx counts. Please try
        another, or modify respective thresholds
      </h2>
    ) : null;

  return (
    <>
      {thresholdsTable}
      {noUsablePairsWarning}
      <PriceTest
        key={`price_test_${props.base}_${props.target}`}
        base={props.base}
        target={props.target}
        usablePairs={usablePairs}
        ignoredPairs={ignoredPairs}
      />
    </>
  );
};

export default ThresholdPriceTest;
