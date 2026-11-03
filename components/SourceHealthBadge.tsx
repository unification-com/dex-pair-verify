// components/SourceHealthBadge.tsx
// A source's subgraph health (lib/sourceHealthState.ts) as a badge, with what the
// state means on hover. Pass `error` (operator view only) to append the last failure.
import React from "react";

import { SourceHealthState, sourceHealthState } from "../lib/sourceHealthState";

const LOOK: Record<SourceHealthState, { cls: string; label: string; meaning: string }> = {
  unchecked: { cls: "badge-neutral", label: "unchecked", meaning: "not health-checked yet" },
  healthy: { cls: "badge-pass", label: "healthy", meaning: "its subgraph passed the last health check" },
  failing: { cls: "badge-warn", label: "failing", meaning: "failed the last health check; paused if the next one fails too" },
  paused: { cls: "badge-fail", label: "paused", meaning: "left out of OoO pricing until its subgraph passes a health check" },
};

const SourceHealthBadge: React.FC<{ healthCheckedAt: number; healthFailures: number; error?: string }> = ({ healthCheckedAt, healthFailures, error }) => {
  const { cls, label, meaning } = LOOK[sourceHealthState({ healthCheckedAt, healthFailures })];
  return <span className={`badge ${cls} badge-sm`} title={error ? `${meaning}: ${error}` : meaning}>{label}</span>;
};

export default SourceHealthBadge;
