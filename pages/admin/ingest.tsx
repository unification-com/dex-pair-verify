import React, { useState } from "react";
import { NotificationManager } from "react-notifications";

import Layout from "../../components/shell/Layout";
import StatusBadge from "../../components/ui/StatusBadge";
import { TokenPairStatus } from "../../types/types";

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
        const resp = await fetch("/api/admin/ingest", {
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

      setCurrent(`${d.chain}_${d.dex} · page ${d.page}${d.skipped ? " (skipped — not on GeckoTerminal)" : ""}`);
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

  const isVerdictStatus = (k: string): k is TokenPairStatus =>
    (Object.values(TokenPairStatus) as string[]).includes(k);

  return (
    <Layout>
      <div className="page">
        <h1>Ingest from GeckoTerminal</h1>
        <p>
          Discovers + hydrates pools from GeckoTerminal for every supported (chain, dex) and
          assigns a verdict to each pair inline. Paced to respect the API rate limit. Operator
          (Manual) verdicts are never overridden.
        </p>

        <button onClick={run} disabled={running} type="button">
          {running ? "Running…" : done ? "Run again" : "Start ingest"}
        </button>

        <h3>
          Pairs ingested: {pairs}
          {current && <> · {current}</>}
          {done && <> · ✓ done</>}
        </h3>

        {Object.keys(tallies).length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Verdict</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {TALLY_ORDER.filter((k) => tallies[k]).map((k) => (
                <tr key={k}>
                  <td>{isVerdictStatus(k) ? <StatusBadge status={k} method={""} /> : k}</td>
                  <td>{tallies[k]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
};

export default Ingest;
