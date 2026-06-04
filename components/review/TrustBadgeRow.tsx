// components/review/TrustBadgeRow.tsx
// Row of at-a-glance trust signals for a pair: Identity, Canonical, Factory,
// Scam, and (when present) cross-source Sibling. Each badge is tone-coloured
// with an icon + label + value so it reads without colour alone.
//
// Pass the booleans you already compute for the fences; this component does no
// data work, only presentation.
import React from "react";

import Icon from "../ui/Icon";

export type TrustSignals = {
  identityConfirmed: boolean;
  canonical: "match" | "impostor" | "unknown";
  factory: "canonical" | "mismatch" | "unknown";
  scamFlagged: boolean;
  scamReason?: string;
  verifiedOnOtherDexs?: number; // 0/undefined hides the Sibling badge
};

type Tone = "pass" | "fail" | "warn" | "skip" | "accent";

const TrustBadge: React.FC<{ tone: Tone; glyph: string; label: string; value: string; title?: string }> = ({ tone, glyph, label, value, title }) => (
  <span className={`trust trust-${tone}`} title={title || ""}>
    <span className="t-ico"><Icon name={glyph} size={13} /></span>
    <span className="t-body"><span className="t-label">{label}</span><span className="t-value">{value}</span></span>
  </span>
);

const TrustBadgeRow: React.FC<{ signals: TrustSignals }> = ({ signals: s }) => {
  const items: Array<React.ComponentProps<typeof TrustBadge>> = [
    { tone: s.identityConfirmed ? "pass" : "fail", glyph: s.identityConfirmed ? "check" : "alert", label: "Identity", value: s.identityConfirmed ? "confirmed" : "unconfirmed", title: "Both tokens CoinGecko-listed or identity-confirmed" },
    { tone: s.canonical === "unknown" ? "skip" : s.canonical === "match" ? "pass" : "fail", glyph: s.canonical === "unknown" ? "dash" : s.canonical === "match" ? "check" : "alert", label: "Canonical", value: s.canonical, title: "Token addresses vs CoinGecko-canonical" },
    { tone: s.factory === "unknown" ? "skip" : s.factory === "canonical" ? "pass" : "warn", glyph: s.factory === "unknown" ? "dash" : s.factory === "canonical" ? "check" : "alert", label: "Factory", value: s.factory, title: "Pool factory vs canonical DEX factory" },
    { tone: s.scamFlagged ? "fail" : "pass", glyph: "shield", label: "Scam", value: s.scamFlagged ? "flagged" : "clear", title: s.scamReason || "GoPlus scam-list" },
  ];
  if (s.verifiedOnOtherDexs && s.verifiedOnOtherDexs > 0) {
    items.push({ tone: "accent", glyph: "check", label: "Sibling", value: `verified on ${s.verifiedOnOtherDexs} DEX${s.verifiedOnOtherDexs > 1 ? "s" : ""}`, title: "Same canonical key verified on another source" });
  }
  return <div className="trust-row">{items.map((it, i) => <TrustBadge key={i} {...it} />)}</div>;
};

export default TrustBadgeRow;
