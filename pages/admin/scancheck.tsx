import React, { useState } from "react";
import { NotificationManager } from "react-notifications";

import PassRunnerLayout from "../../components/admin/PassRunnerLayout";
import Layout from "../../components/shell/Layout";

// GoPlus free tier is 30 req/min; pace batches of 10 so we stay well under it.
const CALL_DELAY_MS = 21000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ScanCheck: React.FC = () => {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [flagged, setFlagged] = useState(0);
  const [demoted, setDemoted] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);

  async function run() {
    setRunning(true);
    setDone(false);
    setProcessed(0);
    setFlagged(0);
    setDemoted(0);
    setRemaining(null);

    let jobStartedAt: number | undefined;
    let totalProcessed = 0;
    let totalFlagged = 0;
    let totalDemoted = 0;

    for (;;) {
      let json;
      try {
        const resp = await fetch("/api/admin/scancheck", {
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
      totalFlagged += d.flagged;
      totalDemoted += d.demotedPairs;
      setProcessed(totalProcessed);
      setFlagged(totalFlagged);
      setDemoted(totalDemoted);
      setRemaining(d.remaining);

      if (d.done) {
        setDone(true);
        NotificationManager.success("Done", `Checked ${totalProcessed} tokens, ${totalFlagged} flagged`, 6000);
        break;
      }
      // No progress but not done would loop forever — guard against it.
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
    <Layout crumb="Scam check">
      <PassRunnerLayout
        step={5}
        title="Scam check (GoPlus)"
        pace="GoPlus 30/min"
        description={<>
          Runs GoPlus token-security checks over the tokens in your verified pairs. A flagged token
          (honeypot, extreme tax, self-destruct, hidden owner…) demotes any Auto-Verified pair using it
          to Needs Review — never auto-rejected; you decide. Manual verdicts are untouched. Re-runs only
          check tokens not yet checked.
        </>}
        running={running}
        done={done}
        onRun={run}
        progressPct={pct}
        stats={[
          { label: "Checked", value: processed },
          { label: "Flagged", value: flagged, tone: "fail" },
          { label: "Demoted", value: demoted, tone: "warn" },
          ...(remaining != null ? [{ label: "Remaining", value: remaining } as const] : []),
        ]}
      />
    </Layout>
  );
};

export default ScanCheck;
