// components/review/ReserveVsFloor.tsx
// Liquidity shown in context: a log-scaled bar with the operator floor and the
// hard floor marked, so "$18k vs $25k floor" reads instantly instead of as a
// bare number.
import React from "react";

import { usd } from "../../lib/format";

const ReserveVsFloor: React.FC<{ reserveUsd: number; floor: number; hardFloor: number }> = ({ reserveUsd, floor, hardFloor }) => {
  const lo = Math.max(1, (hardFloor || 500) / 2);
  const hi = Math.max(reserveUsd, floor) * 1.5;
  const L = Math.log10, span = L(hi) - L(lo);
  const pos = (v: number) => Math.max(0, Math.min(100, ((L(Math.max(v, lo)) - L(lo)) / span) * 100));
  const ok = reserveUsd >= floor;
  const tone = reserveUsd < hardFloor ? "fail" : ok ? "pass" : "warn";
  return (
    <div className="rvf">
      <div className="row spread items-baseline">
        <span className="eyebrow">Liquidity vs floor</span>
        <span className="mono" style={{ color: `var(--${tone})`, fontWeight: 600 }}>{usd(reserveUsd)}</span>
      </div>
      <div className="rvf-track">
        <div className="rvf-fill" style={{ width: pos(reserveUsd) + "%", background: `var(--${tone})` }} />
        {hardFloor ? <div className="rvf-mark hard" style={{ left: pos(hardFloor) + "%" }} title={`hard floor ${usd(hardFloor)}`} /> : null}
        <div className="rvf-mark" style={{ left: pos(floor) + "%" }} title={`floor ${usd(floor)}`} />
      </div>
      <div className="row gap-5" style={{ fontSize: "var(--fs-xs)", color: "var(--text-2)" }}>
        <span><b className="mono" style={{ color: "var(--fail)" }}>│</b> hard {usd(hardFloor)}</span>
        <span><b className="mono" style={{ color: "var(--text-1)" }}>│</b> floor {usd(floor)}</span>
      </div>
    </div>
  );
};

export default ReserveVsFloor;
