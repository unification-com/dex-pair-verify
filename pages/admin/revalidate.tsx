import React, { useState } from "react";
import { NotificationManager } from "react-notifications";

import Layout from "../../components/Layout";
import Status from "../../components/Status";
import { TokenPairStatus } from "../../types/types";

// Pace between batches, matching the ingest cadence. Re-validate only hits
// CoinGecko on an intra-chain conflict (rare), and those calls share the
// ingest's 65s 429 back-off (lib/httpBackoff) — so this is mostly headroom.
const BATCH_DELAY_MS = 4500;
const BATCH_SIZE = 25;

// Verdict buckets shown in the live tally, in a sensible reading order.
const TALLY_ORDER: string[] = [
  TokenPairStatus.AutoVerified,
  TokenPairStatus.NeedsReview,
  TokenPairStatus.AutoRejected,
  TokenPairStatus.NotCurrentlyUsable,
  TokenPairStatus.Unverified,
  TokenPairStatus.Duplicate,
  "skippedManual",
  "error",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const Revalidate: React.FC = () => {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [tallies, setTallies] = useState<Record<string, number>>({});

  async function run() {
    setRunning(true);
    setDone(false);
    setProcessed(0);
    setRemaining(null);
    setTallies({});

    let jobStartedAt: number | undefined; // server stamps it on the first call
    const acc: Record<string, number> = {};
    let total = 0;

    for (;;) {
      let json;
      try {
        const resp = await fetch("/api/admin/revalidate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batch: BATCH_SIZE, jobStartedAt }),
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
      jobStartedAt = d.jobStartedAt;
      total += d.processed;
      for (const [k, v] of Object.entries(d.tallies as Record<string, number>)) {
        acc[k] = (acc[k] ?? 0) + v;
      }
      setProcessed(total);
      setRemaining(d.remaining);
      setTallies({ ...acc });

      if (d.done) {
        setDone(true);
        NotificationManager.success("Done", `Revalidated ${total} pairs`, 5000);
        break;
      }
      // No progress but not done would loop forever — guard against it.
      if (d.processed === 0) {
        setDone(true);
        break;
      }
      await sleep(BATCH_DELAY_MS);
    }

    setRunning(false);
  }

  const isVerdictStatus = (k: string): k is TokenPairStatus =>
    (Object.values(TokenPairStatus) as string[]).includes(k);

  return (
    <Layout>
      <div className="page">
        <h1>Re-validate all pairs</h1>
        <p>
          Runs the verdict engine across every pair in throttled batches of {BATCH_SIZE}.
          Operator (Manual) verdicts are never overridden. Safe to stop and restart — it
          resumes where it left off.
        </p>

        <button onClick={run} disabled={running} type="button">
          {running ? "Running…" : done ? "Run again" : "Start re-validation"}
        </button>

        <h3>
          Processed: {processed}
          {remaining !== null && <> · Remaining: {remaining}</>}
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
                  <td>{isVerdictStatus(k) ? <Status status={k} method={""} /> : k}</td>
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

export default Revalidate;
