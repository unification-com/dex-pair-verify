// components/review/FenceChecklist.tsx
// THE core of the pair-detail redesign. Replaces the raw {key:value} evidence
// table. Takes the derived UI fences (see lib/fences.ts → deriveFences) and:
//   1. Pins a "Decision drivers" callout at top = every FAILED fence + every
//      HARD fence (deduped, failures first). This is what the operator must
//      see above the fold — *why* the pair is here.
//   2. Renders the full checklist grouped (Identity / Provenance / Liquidity &
//      Activity / Price) with a per-group pass/fail/partial roll-up.
//   3. Collapses skipped fences (unknown inputs) behind a toggle per group.
//
// Each row shows glyph (✓/✗/–) + label + observed-vs-threshold + weight chip.
import React, { useState } from "react";

import { UiFence, FenceGroup, GROUP_ORDER } from "../../lib/fences";
import Icon from "../ui/Icon";

const FenceGlyph: React.FC<{ ok: boolean | null }> = ({ ok }) => {
  const tone = ok === true ? "pass" : ok === false ? "fail" : "skip";
  const name = ok === true ? "check" : ok === false ? "x" : "dash";
  return <span className={`fglyph fg-${tone}`}><Icon name={name} size={13} /></span>;
};

export const FenceRow: React.FC<{ f: UiFence; emphasize?: boolean }> = ({ f, emphasize }) => {
  const tone = f.ok === true ? "pass" : f.ok === false ? "fail" : "skip";
  return (
    <div className={`fence-row fr-${tone}${emphasize ? " fr-emph" : ""}`}>
      <FenceGlyph ok={f.ok} />
      <div className="fr-main">
        <div className="fr-top">
          <span className="fr-label">{f.label}</span>
          {f.hard ? <span className="chip chip-hard">HARD</span> : null}
          {f.hardFail ? <span className="chip chip-hard">BELOW HARD FLOOR</span> : null}
        </div>
        <div className="fr-note muted">{f.note}</div>
      </div>
      <div className="fr-values">
        <span className={"fr-observed mono" + (f.ok === false ? " is-fail" : "")}>{f.observed}</span>
        <span className="fr-threshold mono">{f.threshold}</span>
      </div>
      <span className="weight-chip" title="fence weight">w{f.weight}</span>
    </div>
  );
};

const FenceChecklist: React.FC<{ fences: UiFence[] }> = ({ fences }) => {
  const [showSkipped, setShowSkipped] = useState(false);

  const failed = fences.filter((f) => f.ok === false);
  const passedN = fences.filter((f) => f.ok === true).length;
  const skippedN = fences.filter((f) => f.ok === null).length;

  // drivers = failed ∪ hard, deduped, failures first
  const seen = new Set<string>();
  const drivers: UiFence[] = [];
  [...failed, ...fences.filter((f) => f.hard)].forEach((f) => { if (!seen.has(f.key)) { seen.add(f.key); drivers.push(f); } });

  const groups = GROUP_ORDER.map((g: FenceGroup) => {
    const items = fences.filter((f) => f.group === g);
    const anyFail = items.some((f) => f.ok === false);
    const allSkip = items.every((f) => f.ok === null);
    const w = items.reduce((s, f) => s + (f.ok !== null ? f.weight : 0), 0);
    const wp = items.reduce((s, f) => s + (f.ok === true ? f.weight : 0), 0);
    return { name: g, items, anyFail, allSkip, w, wp };
  });

  return (
    <div className="fchk">
      <div className={`fchk-drivers ${drivers.length ? "has-drivers" : "clear"}`}>
        <div className="row spread" style={{ marginBottom: drivers.length ? "var(--sp-4)" : 0 }}>
          <span className="eyebrow">{drivers.length ? "Decision drivers" : "Fence summary"}</span>
          <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>{failed.length} failed · {skippedN} skipped · {passedN} passed</span>
        </div>
        {drivers.length
          ? drivers.map((f) => <FenceRow key={f.key} f={f} emphasize />)
          : <div className="row gap-3" style={{ color: "var(--pass)" }}><Icon name="check" size={16} /><span style={{ fontWeight: 600, color: "var(--text-0)" }}>No failing or hard fences — all decision gates clear.</span></div>}
      </div>

      <div className="fchk-groups">
        {groups.map((g) => (
          <div key={g.name} className="fchk-group">
            <div className="fchk-group-head">
              <span className={`badge ${g.anyFail ? "badge-fail" : g.allSkip ? "badge-skip" : "badge-pass"}`}>
                <span className="glyph">{g.anyFail ? "✕" : g.allSkip ? "–" : "✓"}</span>{g.name}
              </span>
              <span className="grow" />
              <span className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>{g.allSkip ? "skipped" : `${g.wp}/${g.w} weight`}</span>
            </div>
            <div className="fchk-group-body">
              {g.items.filter((f) => showSkipped || f.ok !== null).map((f) => <FenceRow key={f.key} f={f} />)}
              {!showSkipped && g.items.some((f) => f.ok === null)
                ? <button className="fchk-skipbtn" onClick={() => setShowSkipped(true)}>+ {g.items.filter((f) => f.ok === null).length} skipped fence(s)</button>
                : null}
            </div>
          </div>
        ))}
        {showSkipped ? <button className="fchk-skipbtn" style={{ alignSelf: "flex-start" }} onClick={() => setShowSkipped(false)}>Hide skipped fences</button> : null}
      </div>
    </div>
  );
};

export default FenceChecklist;
