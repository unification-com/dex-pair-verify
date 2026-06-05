import React, { useState } from "react";
import { NotificationManager } from "react-notifications";

import Layout from "../../components/shell/Layout";

// CoinGecko free tier rate-limits; pace batches of 10 so we stay under it.
const CALL_DELAY_MS = 21000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CanonicalCheck: React.FC = () => {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [resolved, setResolved] = useState(0);
  const [impostors, setImpostors] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);

  async function run() {
    setRunning(true);
    setDone(false);
    setProcessed(0);
    setResolved(0);
    setImpostors(0);
    setRemaining(null);

    let jobStartedAt: number | undefined;
    let totalProcessed = 0;
    let totalResolved = 0;
    let totalImpostors = 0;

    for (;;) {
      let json;
      try {
        const resp = await fetch("/api/admin/canonicalcheck", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobStartedAt }),
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
      totalProcessed += d.processed;
      totalResolved += d.resolved;
      totalImpostors += d.impostorPairs;
      setProcessed(totalProcessed);
      setResolved(totalResolved);
      setImpostors(totalImpostors);
      setRemaining(d.remaining);

      if (d.done) {
        setDone(true);
        NotificationManager.success(
          "Done",
          `Checked ${totalProcessed} tokens, ${totalResolved} canonicals, ${totalImpostors} impostor pairs`,
          6000,
        );
        break;
      }
      if (d.processed === 0) {
        setDone(true);
        break;
      }
      await sleep(CALL_DELAY_MS);
    }

    setRunning(false);
  }

  return (
    <Layout>
      <div className="page">
        <h1>Canonical check (CoinGecko)</h1>
        <p>
          Resolves the CoinGecko-canonical contract address for every CoinGecko-listed pair token,
          so the impostor fence can run on every pair — not just intra-chain conflicts. A token whose
          on-chain address doesn&apos;t match the canonical contract for its coin id is routed to
          Needs Review (a possible impostor, or a legitimate multi-contract/bridged variant — you
          decide; never auto-rejected). Manual verdicts are untouched (R6). Paced for the CoinGecko
          free-tier limit, so a first full run is slow; re-runs only check tokens not yet resolved.
        </p>

        <button onClick={run} disabled={running} type="button">
          {running ? "Running…" : done ? "Run again" : "Start canonical check"}
        </button>

        <h3>
          Checked: {processed}
          {remaining !== null && <> · Remaining: {remaining}</>}
          {done && <> · ✓ done</>}
        </h3>
        <p>
          <strong>{resolved}</strong> canonical addresses resolved · <strong>{impostors}</strong>{" "}
          pairs routed to Needs Review (possible impostor)
        </p>
      </div>
    </Layout>
  );
};

export default CanonicalCheck;
