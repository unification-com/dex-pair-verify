import { GetServerSideProps } from "next";
import React, { useState } from "react";
import { NotificationManager } from "react-notifications";

import Layout from "../../components/Layout";
import prisma from "../../lib/prisma";
import { getSourceByIndex, sourceCount } from "../../lib/sourceConfig";

type ThresholdRow = {
  id: string;
  chain: string;
  dex: string;
  minLiquidityUsd: number;
  minTxCount: number;
  minAgeHours: number;
  maxPriceDeviationPercent: number;
  minDecimals: number;
  maxDecimals: number;
  requireCgListed: boolean;
};

// Editable numeric columns, in display order.
const NUM_FIELDS: { key: keyof ThresholdRow; label: string }[] = [
  { key: "minLiquidityUsd", label: "Min Liquidity $" },
  { key: "minTxCount", label: "Min Tx (24h)" },
  { key: "minAgeHours", label: "Min Age (h)" },
  { key: "maxPriceDeviationPercent", label: "Max Price Dev %" },
  { key: "minDecimals", label: "Min Dec" },
  { key: "maxDecimals", label: "Max Dec" },
];

export const getServerSideProps: GetServerSideProps = async () => {
  // Ensure a threshold row exists for every configured source so the operator
  // can tune them all, even before any ingest has created rows lazily.
  for (let i = 0; i < sourceCount; i += 1) {
    const s = getSourceByIndex(i);
    if (!s) {
      continue;
    }
    const existing = await prisma.threshold.findFirst({ where: { chain: s.chain, dex: s.dex } });
    if (!existing) {
      await prisma.threshold.create({
        data: { chain: s.chain, dex: s.dex, minLiquidityUsd: 0, minTxCount: 0 },
      });
    }
  }

  const thresholds = await prisma.threshold.findMany({ orderBy: [{ chain: "asc" }, { dex: "asc" }] });
  return { props: { thresholds } };
};

const Thresholds: React.FC<{ thresholds: ThresholdRow[] }> = ({ thresholds }) => {
  const [rows, setRows] = useState<ThresholdRow[]>(thresholds);

  const update = (id: string, field: keyof ThresholdRow, value: number | boolean) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  async function save(row: ThresholdRow) {
    const res = await fetch("/api/admin/setthreshold", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    }).then((r) => r.json());

    if (res.success) {
      NotificationManager.success("Saved", `${row.chain}_${row.dex} thresholds updated`, 4000);
    } else {
      NotificationManager.error("Error", `${res.err}`, 5000);
    }
  }

  return (
    <Layout>
      <div className="page">
        <h1>Verdict thresholds</h1>
        <p>
          Per-(chain, dex) tuning for the auto-verify engine. Pairs must clear these gates to
          AutoVerify; a CG/DEX price mismatch beyond the tolerance routes to Needs Review.
          Defaults are conservative — loosen per source as you build confidence.
        </p>
        <table>
          <thead>
            <tr>
              <th>Chain</th>
              <th>DEX</th>
              {NUM_FIELDS.map((f) => (
                <th key={f.key}>{f.label}</th>
              ))}
              <th>Require CG</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.chain}</td>
                <td>{row.dex}</td>
                {NUM_FIELDS.map((f) => (
                  <td key={f.key}>
                    <input
                      type="number"
                      value={row[f.key] as number}
                      style={{ width: "6rem" }}
                      onChange={(e) => update(row.id, f.key, Number(e.target.value))}
                    />
                  </td>
                ))}
                <td>
                  <input
                    type="checkbox"
                    checked={row.requireCgListed}
                    onChange={(e) => update(row.id, "requireCgListed", e.target.checked)}
                  />
                </td>
                <td>
                  <button type="button" onClick={() => save(row)}>Save</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
};

export default Thresholds;
