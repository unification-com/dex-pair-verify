import Link from "next/link";
import React from "react";

import Layout from "../../components/Layout";

type Step = { href: string; label: string; what: string };

// The verification pipeline, in the order it should be run after a fresh ingest.
// Each pass is idempotent, cached and resumable, and re-runs the verdict inline,
// so you can stop and inspect between any of them.
const PIPELINE: Step[] = [
  {
    href: "/admin/ingest",
    label: "1 · Ingest",
    what: "Pull pairs from GeckoTerminal and run the verdict inline. Run first — after a fresh dump, or to refresh market data. Seeds the per-(chain,dex) thresholds on first run.",
  },
  {
    href: "/admin/identitycheck",
    label: "2 · Identity Check",
    what: "Resolve identity for tokens with no CoinGecko id (reputable token lists + GoPlus positive signals) and promote genuine pairs out of Needs Review. Run before Scam Check so newly-promoted pairs get scanned. GoPlus-paced — slow on a first full run.",
  },
  {
    href: "/admin/canonicalcheck",
    label: "3 · Canonical Check",
    what: "Resolve each token's CoinGecko-canonical contract address and route address-mismatch impostors to Needs Review. CoinGecko-paced.",
  },
  {
    href: "/admin/factorycheck",
    label: "4 · Factory Check",
    what: "Read each pool's on-chain factory() and route pools not deployed by the canonical DEX factory to Needs Review. RPC — quick.",
  },
  {
    href: "/admin/scancheck",
    label: "5 · Scam Check",
    what: "GoPlus security checks (honeypot, extreme tax, hidden owner…); demote flagged pairs to Needs Review. Run last so it covers everything that ended up verified. GoPlus-paced.",
  },
];

// Tuning + maintenance — run as needed, not part of the linear pipeline.
const MAINTENANCE: Step[] = [
  {
    href: "/admin/thresholds",
    label: "Thresholds",
    what: "Per-(chain, dex) verdict thresholds — liquidity floors, min 24h trades, turnover, confidence band, decimals. Tune here, then Re-validate to apply.",
  },
  {
    href: "/admin/revalidate",
    label: "Re-validate",
    what: "Re-run the verdict across every pair (e.g. after changing thresholds). Fast — no external API calls, no rate limits.",
  },
];

const StepRow: React.FC<{ step: Step }> = ({ step }) => (
  <li style={{ marginBottom: "0.9rem", listStyle: "none" }}>
    <Link href={step.href}>
      <a style={{ fontWeight: 600, fontSize: "1.05rem" }}>{step.label}</a>
    </Link>
    <div style={{ opacity: 0.8, marginTop: "0.15rem" }}>{step.what}</div>
  </li>
);

const AdminHome: React.FC = () => (
  <Layout>
    <div className="page">
      <h1>Admin · verification pipeline</h1>
      <p>
        Run these in order after an ingest. Each pass is <strong>idempotent, cached and resumable</strong>,
        and re-runs the verdict inline — so you can run, stop and inspect the queue between any of them, and
        re-running only processes what hasn&apos;t been done yet.
      </p>

      <h2>Pipeline</h2>
      <ol style={{ paddingLeft: 0 }}>
        {PIPELINE.map((s) => (
          <StepRow key={s.href} step={s} />
        ))}
      </ol>

      <h2>Tuning &amp; maintenance</h2>
      <ul style={{ paddingLeft: 0 }}>
        {MAINTENANCE.map((s) => (
          <StepRow key={s.href} step={s} />
        ))}
      </ul>

      <p style={{ opacity: 0.75, marginTop: "1.5rem" }}>
        Steps 2 and 5 call GoPlus (free tier 30/min) and step 3 calls CoinGecko, so first full runs are slow;
        the per-pass progress shows how many remain. Set <code>GECKO_API_KEY</code> in <code>.env</code> to
        lift the CoinGecko ceiling.
      </p>
    </div>
  </Layout>
);

export default AdminHome;
