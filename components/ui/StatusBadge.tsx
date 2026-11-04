// components/ui/StatusBadge.tsx
// Restyled replacement for the old components/Status.tsx. Colour + glyph + text
// (colour is never the only signal). Drives off STATUS_META so every status is
// consistent everywhere.
import React from "react";

import { STATUS_META } from "../../lib/statusMeta";
import { TokenPairStatus } from "../../types/types";

const StatusBadge: React.FC<{ status: TokenPairStatus; method?: string; size?: "sm" }> = ({ status, method, size }) => {
  const m = STATUS_META[status] || STATUS_META[TokenPairStatus.Unverified];
  return (
    <span className={`badge badge-${m.tone}${size === "sm" ? " badge-sm" : ""}`} title={status}>
      <span className="glyph">{m.glyph}</span>
      {m.label}
      {method ? <span style={{ opacity: 0.6, fontWeight: 500 }}>· {method}</span> : null}
    </span>
  );
};

export default StatusBadge;
