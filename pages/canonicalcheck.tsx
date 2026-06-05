import React, { useState } from "react";
import { NotificationManager } from "react-notifications";

import PassRunnerLayout from "../components/admin/PassRunnerLayout";
import Layout from "../components/shell/Layout";

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
        const resp = await fetch("/api/canonicalcheck", {
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

  const pct = remaining != null ? (processed + remaining > 0 ? (processed / (processed + remaining)) * 100 : 100) : done ? 100 : undefined;

  return (
    <Layout crumb="Canonical check">
      <PassRunnerLayout
        step={3}
        title="Canonical check (CoinGecko)"
        pace="CoinGecko-paced"
        description={<>
          Resolves the CoinGecko-canonical contract address for every CoinGecko-listed pair token, so the
          impostor fence can run on every pair — not just intra-chain conflicts. A token whose on-chain
          address doesn&apos;t match the canonical contract for its coin id is routed to Needs Review (a
          possible impostor, or a legitimate multi-contract/bridged variant — you decide; never
          auto-rejected). Manual verdicts are untouched (R6). Re-runs only check tokens not yet resolved.
        </>}
        running={running}
        done={done}
        onRun={run}
        progressPct={pct}
        stats={[
          { label: "Checked", value: processed },
          { label: "Resolved", value: resolved, tone: "pass" },
          { label: "Impostors", value: impostors, tone: "warn" },
          ...(remaining != null ? [{ label: "Remaining", value: remaining }] : []),
        ]}
      />
    </Layout>
  );
};

export default CanonicalCheck;
