import React, { useState } from "react";
import { NotificationManager } from "react-notifications";

import Layout from "../../components/Layout";

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

  return (
    <Layout>
      <div className="page">
        <h1>Identity check (token lists + GoPlus)</h1>
        <p>
          Resolves multi-source identity for tokens with no CoinGecko coin id — the ones that
          otherwise block auto-verify. A token confirmed by ≥2 independent categories (a reputable
          token list AND GoPlus positive signals) is treated as a real token, so its pair can leave
          Needs Review without a CoinGecko listing. Confirming a token re-runs the verdict on its
          pairs inline, so promotions happen as you go. Manual verdicts are untouched (R6). Paced
          for the GoPlus free-tier 30/min limit, so a first full run is slow; re-runs only check
          tokens not yet checked.
        </p>

        <button onClick={run} disabled={running} type="button">
          {running ? "Running…" : done ? "Run again" : "Start identity check"}
        </button>

        <h3>
          Checked: {processed}
          {remaining !== null && <> · Remaining: {remaining}</>}
          {done && <> · ✓ done</>}
        </h3>
        <p>
          <strong>{confirmed}</strong> tokens identity-confirmed · <strong>{promoted}</strong> pairs
          promoted to Auto-Verified
        </p>
      </div>
    </Layout>
  );
};

export default IdentityCheck;
