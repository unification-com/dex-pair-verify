// components/dashboard/StatCard.tsx
// Headline metric tile for the dashboard / admin home. `accent` highlights the
// primary "Needs review" card; `tone` colours the number + icon for semantic
// counts (fail/warn/pass/info). Make it a link by passing onClick.
import React, { ReactNode } from "react";

import Icon from "../ui/Icon";

const StatCard: React.FC<{
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "pass" | "fail" | "warn" | "info";
  icon?: string;
  accent?: boolean;
  onClick?: () => void;
}> = ({ label, value, sub, tone, icon, accent, onClick }) => (
  <div className={`statcard card${onClick ? " clickable" : ""}${accent ? " statcard-accent" : ""}`} onClick={onClick} role={onClick ? "button" : undefined}>
    <div className="row spread items-start">
      <span className="eyebrow">{label}</span>
      {icon ? <span className={`statcard-ico${tone ? " tone-" + tone : ""}`}><Icon name={icon} size={15} /></span> : null}
    </div>
    <div className="statcard-value mono tnum" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
    {sub ? <div className="statcard-sub muted">{sub}</div> : null}
  </div>
);

export default StatCard;
