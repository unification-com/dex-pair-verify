import { GetServerSideProps } from "next";
import React, { useState } from "react";
import { NotificationManager } from "react-notifications";

import Layout from "../../components/shell/Layout";
import PageHeader from "../../components/ui/PageHeader";
import prisma from "../../lib/prisma";
import { getSources, thresholdSeedData } from "../../lib/sourceConfig";

type ThresholdRow = {
  id: string;
  chain: string;
  dex: string;
  minLiquidityUsd: number;
  minTxCount: number;
  minTurnoverRatio: number;
  minAgeHours: number;
  maxPriceDeviationPercent: number;
  minDecimals: number;
  maxDecimals: number;
  requireCgListed: boolean;
  hardMinLiquidityUsd: number;
  autoVerifyConfidence: number;
};

// Editable numeric columns, in display order. `step` allows decimals for the
// confidence band.
const NUM_FIELDS: { key: keyof ThresholdRow; label: string; step?: string }[] = [
  { key: "minLiquidityUsd", label: "Min Liquidity $" },
  { key: "minTxCount", label: "Min Tx (24h)" },
  { key: "minTurnoverRatio", label: "Min Turnover", step: "any" },
  { key: "minAgeHours", label: "Min Age (h)" },
  { key: "maxPriceDeviationPercent", label: "Max Price Dev %", step: "any" },
  { key: "minDecimals", label: "Min Dec" },
  { key: "maxDecimals", label: "Max Dec" },
  { key: "hardMinLiquidityUsd", label: "Hard Min Liq $ (reject)" },
  { key: "autoVerifyConfidence", label: "Auto-Verify Conf (0-1)", step: "any" },
];

export const getServerSideProps: GetServerSideProps = async () => {
  // Ensure a threshold row exists for every configured source so the operator
  // can tune them all, even before any ingest has created rows lazily.
  const sources = await getSources();
  for (const s of sources) {
    const existing = await prisma.threshold.findFirst({ where: { chain: s.chain, dex: s.dex } });
    if (!existing) {
      await prisma.threshold.create({ data: thresholdSeedData(s.chain, s.dex) });
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
    <Layout crumb="Thresholds">
      <PageHeader
        title="Verdict thresholds"
        sub="Per-(chain, dex) tuning for the auto-verify engine. Pairs must clear these gates to Auto-Verify; a CG/DEX price mismatch beyond tolerance routes to Needs Review. Defaults are conservative — loosen per source as you build confidence. Re-validate to apply."
      />
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>Chain</th>
              <th>DEX</th>
              {NUM_FIELDS.map((f) => (
                <th key={f.key} className="num">{f.label}</th>
              ))}
              <th>Require CG</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="mono">{row.chain}</td>
                <td className="mono">{row.dex}</td>
                {NUM_FIELDS.map((f) => (
                  <td key={f.key} className="num">
                    <input
                      className="input"
                      type="number"
                      step={f.step}
                      value={row[f.key] as number}
                      style={{ width: "5.5rem" }}
                      onChange={(e) => update(row.id, f.key, Number(e.target.value))}
                    />
                  </td>
                ))}
                <td style={{ textAlign: "center" }}>
                  <input
                    className="ckbox"
                    type="checkbox"
                    checked={row.requireCgListed}
                    onChange={(e) => update(row.id, "requireCgListed", e.target.checked)}
                  />
                </td>
                <td>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => save(row)}>Save</button>
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
