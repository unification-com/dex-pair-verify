// components/ui/TokenStatusBadge.tsx
// A token's status pill, scam-aware. A confirmed scam/honeypot flag OVERRIDES the verification status:
// a honeypot is never "verified" whatever its identity verdict says. This matters because the
// token-status promotion (lib/tokenStatus.ts) is forward-only — it never demotes a token that a LATER
// scam pass flagged — so a flagged token's stored status can still read AutoVerified. Render a red
// "Scam" pill (with the reason) instead, so the pill never contradicts the security signals.
// Used everywhere a TOKEN's status is shown; pair-level pills keep the plain StatusBadge (a scam-flagged
// token already routes its pairs to NeedsReview, so the pair pill is already correct).
import React from "react";

import StatusBadge from "./StatusBadge";
import { TokenPairStatus } from "../../types/types";

const TokenStatusBadge: React.FC<{
  status: TokenPairStatus;
  scamFlagged?: boolean;
  scamReason?: string | null;
  method?: string;
  size?: "sm";
}> = ({ status, scamFlagged, scamReason, method, size }) => {
  if (scamFlagged) {
    const reason = scamReason || "flagged on a scam list";
    // sm (table cells / token boxes): compact "⚠ Scam" with the reason in the tooltip; full size also
    // shows the reason inline.
    return (
      <span className={`badge badge-fail${size === "sm" ? " badge-sm" : ""}`} title={`Scam — ${reason}`}>
        <span className="glyph">⚠</span>
        Scam
        {size !== "sm" ? <span style={{ opacity: 0.7, fontWeight: 500 }}> · {reason}</span> : null}
      </span>
    );
  }
  return <StatusBadge status={status} method={method} size={size} />;
};

export default TokenStatusBadge;
