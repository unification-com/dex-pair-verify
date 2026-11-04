// components/ui/ConfidenceMeter.tsx
// Horizontal meter for verdict confidence with a tick at the auto-verify bar.
// `compact` renders an inline mini version for table cells.
import React from "react";

const ConfidenceMeter: React.FC<{ value: number | null; threshold?: number; compact?: boolean }> = ({ value, threshold = 0.85, compact }) => {
  if (value == null) return <span className="muted mono">—</span>;
  const pct = Math.round(value * 100);
  const tone = value >= threshold ? "pass" : value >= 0.6 ? "warn" : "fail";

  if (compact) {
    return (
      <span className="conf-compact">
        <span className="meter" style={{ width: 64 }}><i style={{ width: pct + "%", background: `var(--${tone})` }} /></span>
        <span className="mono tnum" style={{ color: `var(--${tone})`, fontWeight: 600 }}>{pct}%</span>
      </span>
    );
  }
  return (
    <div className="conf">
      <div className="row spread items-baseline">
        <span className="eyebrow">Confidence</span>
        <span className="mono tnum" style={{ fontSize: "var(--fs-xl)", fontWeight: 700, color: `var(--${tone})` }}>{pct}%</span>
      </div>
      <div className="conf-track">
        <div className="conf-fill" style={{ width: pct + "%", background: `var(--${tone})` }} />
        <div className="conf-mark" style={{ left: threshold * 100 + "%" }} title={`auto-verify bar ${Math.round(threshold * 100)}%`} />
      </div>
      <div className="row spread" style={{ fontSize: "var(--fs-xs)", color: "var(--text-2)" }}>
        <span>0%</span><span>auto-verify ≥ {Math.round(threshold * 100)}%</span><span>100%</span>
      </div>
    </div>
  );
};

export default ConfidenceMeter;
