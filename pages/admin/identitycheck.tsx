import React, { useState } from "react";
import { NotificationManager } from "react-notifications";

import PassRunnerLayout from "../../components/admin/PassRunnerLayout";
import Layout from "../../components/shell/Layout";

// GoPlus free tier is 30 req/min; pace batches of 10 so we stay well under it.
const CALL_DELAY_MS = 21000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const IdentityCheck: React.FC = () => {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [confirmed, setConfirmed] = useState(0);
  const [promoted, setPromoted] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);

  async function run() {
    setRunning(true);
    setDone(false);
    setProcessed(0);
    setConfirmed(0);
    setPromoted(0);
    setRemaining(null);

    let jobStartedAt: number | undefined;
    let totalProcessed = 0;
    let totalConfirmed = 0;
    let totalPromoted = 0;

    for (;;) {
      let json;
      try {
        const resp = await fetch("/api/admin/identitycheck", {
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
      totalConfirmed += d.confirmed;
      totalPromoted += d.promotedPairs;
      setProcessed(totalProcessed);
      setConfirmed(totalConfirmed);
      setPromoted(totalPromoted);
      setRemaining(d.remaining);

      if (d.done) {
        setDone(true);
        NotificationManager.success(
          "Done",
          `Checked ${totalProcessed} tokens, ${totalConfirmed} confirmed, ${totalPromoted} pairs promoted`,
          6000,
        );
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
    <Layout crumb="Identity check">
      <PassRunnerLayout
        step={2}
        title="Identity check (token lists + GoPlus)"
        pace="GoPlus 30/min"
        description={<>
          Resolves multi-source identity for tokens with no CoinGecko coin id — the ones that otherwise
          block auto-verify. A token confirmed by ≥2 independent categories (a reputable token list AND
          GoPlus positive signals) is treated as real, so its pair can leave Needs Review without a
          CoinGecko listing. Confirming a token re-runs the verdict on its pairs inline. Manual verdicts
          are untouched (R6). Re-runs only check tokens not yet checked.
        </>}
        running={running}
        done={done}
        onRun={run}
        progressPct={pct}
        stats={[
          { label: "Checked", value: processed },
          { label: "Confirmed", value: confirmed, tone: "pass" },
          { label: "Promoted", value: promoted, tone: "pass" },
          ...(remaining != null ? [{ label: "Remaining", value: remaining }] : []),
        ]}
      />
    </Layout>
  );
};

export default IdentityCheck;
