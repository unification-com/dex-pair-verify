import React, { useState } from "react";
import { NotificationManager } from "react-notifications";

import PassRunnerLayout from "../components/admin/PassRunnerLayout";
import Layout from "../components/shell/Layout";
import { TokenPairStatus } from "../types/types";

// Each page makes one GeckoTerminal call (pools with embedded tokens). 6s
// pacing ≈ 10 req/min — generous margin for the shared-IP throttle on the free
// tier. Set GECKO_API_KEY for a dedicated limit and you can lower this.
const CALL_DELAY_MS = 10000;

const TALLY_ORDER: string[] = [
  TokenPairStatus.AutoVerified,
  TokenPairStatus.NeedsReview,
  TokenPairStatus.AutoRejected,
  TokenPairStatus.NotCurrentlyUsable,
  "skippedManual",
  "error",
];

const toneFor = (k: string): string | undefined =>
  k === TokenPairStatus.AutoVerified ? "pass"
    : k === TokenPairStatus.NeedsReview ? "info"
      : k === TokenPairStatus.AutoRejected || k === TokenPairStatus.NotCurrentlyUsable ? "fail"
        : undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const Ingest: React.FC = () => {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [current, setCurrent] = useState<string>("");
  const [pairs, setPairs] = useState(0);
  const [tallies, setTallies] = useState<Record<string, number>>({});

  async function run() {
    setRunning(true);
    setDone(false);
    setPairs(0);
    setTallies({});
    setCurrent("");

    let sourceIndex = 0;
    let page = 1;
    const acc: Record<string, number> = {};
    let totalPairs = 0;

    for (;;) {
      let json;
      try {
        const resp = await fetch("/api/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceIndex, page }),
        });
        json = await resp.json();
      } catch (e) {
        NotificationManager.error("Error", String(e), 6000);
        break;
      }

      if (!json.success) {
        NotificationManager.error("Error", `${json.err}`, 6000);
        break;
      }

      const d = json.data;
      if (d.done && d.chain === undefined) {
        setDone(true);
        break;
      }

      setCurrent(`${d.chain}_${d.dex} · page ${d.page}${d.skipped ? " (skipped)" : ""}`);
      totalPairs += d.pairs ?? 0;
      for (const [k, v] of Object.entries((d.tallies ?? {}) as Record<string, number>)) {
        acc[k] = (acc[k] ?? 0) + v;
      }
      setPairs(totalPairs);
      setTallies({ ...acc });

      if (d.done) {
        setDone(true);
        NotificationManager.success("Done", `Ingested ${totalPairs} pairs`, 5000);
        break;
      }

      sourceIndex = d.nextSourceIndex;
      page = d.nextPage;
      await sleep(CALL_DELAY_MS);
    }

    setRunning(false);
  }

  const tallyStats = TALLY_ORDER.filter((k) => tallies[k]).map((k) => ({ label: k, value: tallies[k], tone: toneFor(k) }));

  return (
    <Layout crumb="Ingest">
      <PassRunnerLayout
        step={1}
        title="Ingest from GeckoTerminal"
        pace="GeckoTerminal"
        description={<>
          Discovers + hydrates pools from GeckoTerminal for every supported (chain, dex) and assigns a
          verdict to each pair inline. Paced to respect the API rate limit. Operator (Manual) verdicts are
          never overridden. Set <code>GECKO_API_KEY</code> in <code>.env</code> to lift the CoinGecko ceiling.
        </>}
        running={running}
        done={done}
        onRun={run}
        stats={[
          { label: "Pairs ingested", value: pairs },
          ...(running && current ? [{ label: "Current", value: current }] : []),
          ...tallyStats,
        ]}
      />
    </Layout>
  );
};

export default Ingest;
