import { GetServerSideProps } from "next"
import Link from "next/link";
import React from "react"

import Layout from "../../components/shell/Layout"
import PageHeader from "../../components/ui/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import { FENCE_WEIGHTS } from "../../lib/fences";
import { REASON_LABEL, STATUS_META } from "../../lib/statusMeta";
import { DEFAULT_VERDICT_CONFIG } from "../../lib/verdict";
import { TokenPairStatus } from "../../types/types";

// The defaults are server-imported from the engine so this page can never drift
// from the real config; they're tunable per-(chain,dex) on /admin/thresholds.
export const getServerSideProps: GetServerSideProps = async () => {
  const c = DEFAULT_VERDICT_CONFIG;
  return {
    props: {
      config: {
        minLiquidityUsd: c.minLiquidityUsd, hardMinLiquidityUsd: c.hardMinLiquidityUsd,
        minTxCount: c.minTxCount, minTurnoverRatio: c.minTurnoverRatio, minAgeHours: c.minAgeHours,
        maxPriceDeviationPercent: c.maxPriceDeviationPercent, minDecimals: c.minDecimals,
        maxDecimals: c.maxDecimals, autoVerifyConfidence: c.autoVerifyConfidence,
      },
    },
  };
}

type Config = {
  minLiquidityUsd: number; hardMinLiquidityUsd: number; minTxCount: number; minTurnoverRatio: number;
  minAgeHours: number; maxPriceDeviationPercent: number; minDecimals: number; maxDecimals: number; autoVerifyConfidence: number;
};
type Props = { config: Config };

// Curated fence descriptions; the WEIGHTS come from the real FENCE_WEIGHTS so
// the numbers can't drift from the engine.
const FENCES: { group: string; name: string; weight: number; hard?: boolean; what: string }[] = [
  { group: "Identity", name: "Both tokens identified", weight: FENCE_WEIGHTS.identified, what: "Each token is CoinGecko-listed OR confirmed real by ≥2 independent sources (token lists + GoPlus). The single biggest gate — a token with no identity has no reference price, so it can't be safely served." },
  { group: "Provenance", name: "Canonical address (per token)", weight: FENCE_WEIGHTS.canonical0, what: "The on-chain contract matches CoinGecko's canonical contract for that coin id. Catches impostors reusing a known symbol. A mismatch → review (it can also be a legit bridged/multi-contract variant — e.g. when MATIC rebranded to POL the canonical contract moved, so a MATIC-labelled pool can legitimately mismatch)." },
  { group: "Provenance", name: "Factory matches canonical", weight: FENCE_WEIGHTS.factory, what: "The pool was deployed by the DEX's real factory contract (read on-chain). A non-canonical factory → review (impostor, or a legit secondary factory)." },
  { group: "Liquidity & Activity", name: "Liquidity floor", weight: FENCE_WEIGHTS.liquidity, what: "Reserve ≥ the soft floor. Below a separate HARD floor it auto-rejects — too thin to price / cheap to manipulate." },
  { group: "Liquidity & Activity", name: "Tx count", weight: FENCE_WEIGHTS.txCount, what: "Lifetime swaps ≥ floor — a deep-but-dormant pool can carry a stale price." },
  { group: "Liquidity & Activity", name: "Turnover", weight: FENCE_WEIGHTS.turnover, what: "24h volume ÷ liquidity ≥ floor — confirms the price is fresh, not just deep." },
  { group: "Liquidity & Activity", name: "Token age", weight: FENCE_WEIGHTS.age0, what: "Time since deployment ≥ floor — brand-new tokens are riskier (rug potential)." },
  { group: "Liquidity & Activity", name: "Decimals sane", weight: FENCE_WEIGHTS.decimals0, hard: true, what: "Token decimals within a sane range. HARD — bogus decimals auto-reject, since the price maths would be wrong." },
  { group: "Price", name: "CG/DEX price deviation", weight: FENCE_WEIGHTS.price0, what: "The DEX price agrees with CoinGecko's reference within tolerance. Skipped when either price is unavailable (so it often doesn't score)." },
];

const STATUS_NOTE: Partial<Record<TokenPairStatus, string>> = {
  [TokenPairStatus.Unverified]: "Imported, not yet evaluated by the engine.",
  [TokenPairStatus.AutoVerified]: "Passed the gates above the confidence bar — exported to the oracle.",
  [TokenPairStatus.ManualVerified]: "Operator-confirmed — confidence is forced to 100%, exported.",
  [TokenPairStatus.NeedsReview]: "Passed most gates but missed a soft one (usually identity, or a canonical/factory mismatch) — needs a human call. This is the daily queue.",
  [TokenPairStatus.AutoRejected]: "Failed a hard gate (bogus decimals, or unidentified AND below the soft liquidity floor) — not usable.",
  [TokenPairStatus.ManualRejected]: "Operator-rejected.",
  [TokenPairStatus.Duplicate]: "A duplicate of another pair / token symbol.",
  [TokenPairStatus.NotCurrentlyUsable]: "Lost an intra-DEX impostor conflict (a different contract won the canonical match), or otherwise not currently usable.",
};

const Help: React.FC<Props> = ({ config }) => {
  const groups = ["Identity", "Provenance", "Liquidity & Activity", "Price"];
  return (
    <Layout crumb="Help">
      <PageHeader title="Scoring & decision guide" sub="How a verdict and its confidence are reached, and how to read them when reviewing." />

      <div className="help">
        <section className="card card-pad">
          <h3>How a verdict is reached</h3>
          <p className="muted">
            Every pair runs through a set of weighted <strong>fences</strong>. Each fence either passes, fails,
            or is <em>skipped</em> (its input is unknown). <strong>Confidence</strong> is the share of the
            <em> scored</em> (non-skipped) fence weight that passed — so a skipped fence neither helps nor hurts.
          </p>
          <div className="formula mono">confidence = passed scored weight ÷ total scored weight</div>
          <ul className="tight">
            <li>A pair Auto-Verifies when it clears the core gates <em>and</em> confidence ≥ the auto-verify bar
              (<span className="mono">{Math.round(config.autoVerifyConfidence * 100)}%</span> by default).</li>
            <li>An operator <strong>Verify</strong> sets confidence to <span className="mono">100%</span> regardless.</li>
            <li>Canonical-confirmed deep pairs can auto-verify just below the bar (AV-1), carrying their real (sub-100%) score.</li>
            <li>Thresholds are per-(chain, dex) and tunable on <Link href="/admin/thresholds"><a>Thresholds</a></Link> — then <Link href="/admin/revalidate"><a>Re-validate</a></Link>.</li>
          </ul>
        </section>

        <section className="card card-pad">
          <h3>Statuses</h3>
          <div className="status-list">
            {(Object.keys(STATUS_META) as TokenPairStatus[]).map((s) => (
              <div key={s} className="status-row">
                <StatusBadge status={s} size="sm" />
                <span className="muted">{STATUS_NOTE[s]}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card card-pad">
          <h3>The fences &amp; their weights</h3>
          <p className="muted">Higher weight = bigger influence on confidence. <span className="badge badge-fail badge-sm">HARD</span> fences auto-reject on failure rather than just lowering the score.</p>
          {groups.map((g) => (
            <div key={g} className="fgroup">
              <span className="eyebrow">{g}</span>
              {FENCES.filter((f) => f.group === g).map((f) => (
                <div key={f.name} className="frow">
                  <div className="frow-head">
                    <span className="fname">{f.name}</span>
                    <span className="weight-chip">w{f.weight}</span>
                    {f.hard ? <span className="badge badge-fail badge-sm">HARD</span> : null}
                  </div>
                  <p className="muted fwhat">{f.what}</p>
                </div>
              ))}
            </div>
          ))}
          <p className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: "var(--sp-4)" }}>
            Default thresholds: liquidity floor <span className="mono">${config.minLiquidityUsd}</span> (hard <span className="mono">${config.hardMinLiquidityUsd}</span>) ·
            min tx <span className="mono">{config.minTxCount}</span> · min turnover <span className="mono">{config.minTurnoverRatio}</span> ·
            min age <span className="mono">{config.minAgeHours}h</span> · max price deviation <span className="mono">{config.maxPriceDeviationPercent}%</span> ·
            decimals <span className="mono">{config.minDecimals}–{config.maxDecimals}</span>.
          </p>
        </section>

        <section className="card card-pad">
          <h3>Review triage</h3>
          <p className="muted">NeedsReview pairs are split so you can clear them efficiently:</p>
          <div className="status-row"><span className="badge badge-fail badge-sm">Likely spam</span><span className="muted">Canonical-impostor, scam-flagged, or a no-cgId token faking a major symbol. Filter to these, select all, Reject in bulk.</span></div>
          <div className="status-row"><span className="badge badge-warn badge-sm">Worth a look</span><span className="muted">Genuine-but-uncertain — usually a real-looking token with no CoinGecko id. These need judgement.</span></div>
        </section>

        <section className="card card-pad">
          <h3>Reading it — judgement calls</h3>
          <ul className="tight">
            <li><strong>No-cgId, otherwise clean (e.g. ARQ).</strong> Real factory, sane decimals, decent liquidity, no scam — but no CoinGecko id and not on token lists. High confidence but parked on the identity gate. If GoPlus / a token list later confirms it, it auto-promotes. Otherwise it&apos;s a genuine human call: is this a real project?</li>
            <li><strong>Canonical mismatch (e.g. MATIC→POL).</strong> A token with a valid cgId but an address that doesn&apos;t match CoinGecko&apos;s canonical contract. Often an impostor — but after a rebrand the canonical contract can legitimately move, so check whether the mismatch is the new official contract before rejecting.</li>
            <li><strong>Scam-flagged.</strong> A GoPlus hard signal (honeypot, extreme tax, self-destruct) demotes a pair to review — it&apos;s a strong reject signal, but you decide.</li>
            <li><strong>Verified cross-source sibling.</strong> The same canonical pair already verified on another DEX/chain is a strong &ldquo;this is real&rdquo; cue.</li>
          </ul>
        </section>

        <section className="card card-pad">
          <h3>GoPlus security signals</h3>
          <p className="muted">
            The Scam scan calls GoPlus&apos;s token-security API and stores the raw response on the token (shown
            on the token page). Only <strong>strong, direct</strong> evidence that a holder can&apos;t safely sell
            <em> flags</em> a token — demoting any Auto-Verified pair using it to Needs Review (never auto-rejected;
            you decide). Everything else is informational.
          </p>
          <div className="gp-block">
            <span className="eyebrow">Flags the token → Needs Review</span>
            <ul className="tight">
              <li><span className="mono">is_honeypot</span> — buyable but not sellable. The strongest signal.</li>
              <li><span className="mono">cannot_sell_all</span> — a holder can&apos;t sell their whole balance.</li>
              <li><span className="mono">selfdestruct</span> — the contract can self-destruct.</li>
              <li><span className="mono">buy_tax</span> / <span className="mono">sell_tax</span> — transfer taxes; above <strong>10%</strong> counts as a scam signal.</li>
            </ul>
          </div>
          <div className="gp-block">
            <span className="eyebrow">Deliberately ignored (false-positive on legit tokens)</span>
            <ul className="tight">
              <li><span className="mono">hidden_owner</span>, <span className="mono">honeypot_with_same_creator</span>, <span className="mono">mintable</span>, <span className="mono">pausable</span> — normal for legitimate upgradeable / governance / launchpad contracts; they wrongly demoted real tokens (RSR, BAND, OCEAN…), so they don&apos;t flag here.</li>
            </ul>
          </div>
          <div className="gp-block">
            <span className="eyebrow">Informational / positive (not a scam flag)</span>
            <ul className="tight">
              <li><span className="mono">holder_count</span> — number of holders (also in the web-presence panel).</li>
              <li><span className="mono">is_open_source</span> — source verified. With a healthy holder count or <span className="mono">trust_list</span> membership it feeds the <em>identity</em> check (a positive legitimacy signal), not the scam check.</li>
              <li><span className="mono">is_proxy</span>, <span className="mono">is_in_dex</span>, <span className="mono">owner_address</span>, the tax values — context for your manual call.</li>
            </ul>
          </div>
        </section>

        <section className="card card-pad">
          <h3>Verdict reason codes</h3>
          <div className="reason-list">
            {Object.entries(REASON_LABEL).map(([code, label]) => (
              <div key={code} className="reason-row"><span className="reason-code mono">{code}</span><span className="muted">{label}</span></div>
            ))}
          </div>
        </section>
      </div>

      <style jsx>{`
        .help { display: flex; flex-direction: column; gap: var(--sp-5); max-width: 860px; }
        h3 { font-size: var(--fs-lg); margin-bottom: var(--sp-3); }
        .formula { background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--r-md); padding: var(--sp-3) var(--sp-4); margin: var(--sp-3) 0; color: var(--accent-text); }
        ul.tight { margin: var(--sp-3) 0 0; padding-left: var(--sp-6); display: flex; flex-direction: column; gap: var(--sp-3); color: var(--text-1); font-size: var(--fs-sm); }
        .gp-block { margin-top: var(--sp-4); }
        .gp-block .eyebrow { display: block; }
        .status-list { display: flex; flex-direction: column; gap: var(--sp-3); }
        .status-row { display: flex; align-items: center; gap: var(--sp-4); font-size: var(--fs-sm); padding: var(--sp-2) 0; }
        .fgroup { margin-top: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-3); }
        .frow { border-left: 2px solid var(--border-strong); padding-left: var(--sp-4); }
        .frow-head { display: flex; align-items: center; gap: var(--sp-3); }
        .fname { font-weight: 600; font-size: var(--fs-sm); }
        .fwhat { font-size: var(--fs-xs); margin: 2px 0 0; line-height: var(--lh-base); }
        .reason-list { display: flex; flex-direction: column; gap: var(--sp-1); }
        .reason-row { display: flex; gap: var(--sp-4); font-size: var(--fs-sm); padding: var(--sp-2) 0; border-bottom: 1px solid var(--border); }
        .reason-code { color: var(--text-1); min-width: 220px; }
      `}</style>
    </Layout>
  );
};

export default Help;
