import React, { useState } from "react";
import { NotificationManager } from "react-notifications";

import PassRunnerLayout from "../components/admin/PassRunnerLayout";
import Layout from "../components/shell/Layout";
import { operatorOnlyGSSP } from "../lib/operatorGate";

// RPC reads are lighter than the GoPlus limit; a short pace keeps public RPCs
// happy while staying brisk.
const CALL_DELAY_MS = 3000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FactoryCheck: React.FC = () => {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [read, setRead] = useState(0);
  const [mismatches, setMismatches] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);

  async function run() {
    setRunning(true);
    setDone(false);
    setProcessed(0);
    setRead(0);
    setMismatches(0);
    setRemaining(null);

    let jobStartedAt: number | undefined;
    let totalProcessed = 0;
    let totalRead = 0;
    let totalMismatches = 0;

    for (;;) {
      let json;
      try {
        const resp = await fetch("/api/admin/factorycheck", {
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
      totalRead += d.factoriesRead;
      totalMismatches += d.mismatches;
      setProcessed(totalProcessed);
      setRead(totalRead);
      setMismatches(totalMismatches);
      setRemaining(d.remaining);

      if (d.done) {
        setDone(true);
        NotificationManager.success(
          "Done",
          `Checked ${totalProcessed} pairs, ${totalRead} factories read, ${totalMismatches} mismatches`,
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
    <Layout crumb="Factory check">
      <PassRunnerLayout
        step={4}
        title="Factory check (on-chain)"
        pace="RPC — quick"
        description={<>
          Reads each pool contract&apos;s on-chain <code>factory()</code> and compares it to the canonical
          DEX factory for that (chain, dex). A match confirms the pool was deployed by the real DEX (raising
          confidence); a mismatch routes the pair to Needs Review — possibly an impostor, possibly a
          legitimate secondary factory, so you decide rather than auto-reject. Factory addresses are
          immutable, so each pair is read once. Manual verdicts are untouched (R6).
        </>}
        running={running}
        done={done}
        onRun={run}
        progressPct={pct}
        stats={[
          { label: "Checked", value: processed },
          { label: "Factories read", value: read, tone: "pass" },
          { label: "Mismatches", value: mismatches, tone: "warn" },
          ...(remaining != null ? [{ label: "Remaining", value: remaining }] : []),
        ]}
      />
    </Layout>
  );
};

export const getServerSideProps = operatorOnlyGSSP;

export default FactoryCheck;
