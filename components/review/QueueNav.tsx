// components/review/QueueNav.tsx
// Prev / "X of Y" / Next within the current filtered queue, plus an optional
// "Verify & next" primary action. Wire onPrev/onNext to push the next pair id
// into the router (carry the active filter in the query string). Bind the same
// handlers to ← / → / V keys on the pair-detail page (see DESIGN.md).
import React from "react";

import Icon from "../ui/Icon";

const QueueNav: React.FC<{
  index: number;            // 0-based position in the filtered queue
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onVerifyNext?: () => void;
  label?: string;           // e.g. "in Needs Review"
}> = ({ index, total, onPrev, onNext, onVerifyNext, label }) => (
  <div className="qnav">
    <button className="btn btn-icon" onClick={onPrev} disabled={index <= 0} title="Previous (←)"><Icon name="chevL" /></button>
    <div className="qnav-mid">
      <span className="mono tnum" style={{ fontWeight: 600 }}>{index + 1}</span>
      <span className="muted mono"> / {total}</span>
      {label ? <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>{label}</div> : null}
    </div>
    <button className="btn btn-icon" onClick={onNext} disabled={index >= total - 1} title="Next (→)"><Icon name="chevR" /></button>
    {onVerifyNext ? <button className="btn btn-primary btn-sm" onClick={onVerifyNext} title="Verify & next (V)"><Icon name="check" size={14} />Verify &amp; next</button> : null}
  </div>
);

export default QueueNav;
