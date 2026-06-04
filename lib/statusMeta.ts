// lib/statusMeta.ts
// Single source of truth mapping TokenPairStatus → display label, semantic
// tone, and glyph. Used by StatusBadge and anywhere a status is shown.
// `tone` selects the colour token family (--pass / --fail / --warn / --info /
// --skip) and the matching badge class. Glyph + label make colour never the
// ONLY signal (accessibility).

import { TokenPairStatus } from "../types/types";

export type Tone = "pass" | "fail" | "warn" | "info" | "skip" | "neutral";

export type StatusMeta = { label: string; tone: Tone; glyph: string; auto?: boolean };

export const STATUS_META: Record<TokenPairStatus, StatusMeta> = {
  [TokenPairStatus.Unverified]:         { label: "Unverified",    tone: "neutral", glyph: "○" },
  [TokenPairStatus.AutoVerified]:       { label: "Auto-Verified", tone: "pass",    glyph: "✓", auto: true },
  [TokenPairStatus.ManualVerified]:     { label: "Verified",      tone: "pass",    glyph: "✓" },
  [TokenPairStatus.AutoRejected]:       { label: "Auto-Rejected", tone: "fail",    glyph: "✕", auto: true },
  [TokenPairStatus.ManualRejected]:     { label: "Rejected",      tone: "fail",    glyph: "✕" },
  [TokenPairStatus.NeedsReview]:        { label: "Needs Review",  tone: "info",    glyph: "◆" },
  [TokenPairStatus.Duplicate]:          { label: "Duplicate",     tone: "warn",    glyph: "⧉" },
  [TokenPairStatus.NotCurrentlyUsable]: { label: "Not Usable",    tone: "fail",    glyph: "⊘" },
};

// Human label for each VERDICT_REASON code (verdict-engine__lib_verdict.ts).
// Shown in VerdictSummary instead of the raw code.
export const REASON_LABEL: Record<string, string> = {
  intraChainImpostorLoser: "Lost an intra-DEX impostor conflict",
  liquidityBelowHardFloor: "Liquidity below hard floor",
  decimalsBogus: "Token decimals look bogus",
  notIdentified: "A token is not identified",
  scamFlagged: "A token is scam-flagged",
  factoryMismatch: "Pool factory ≠ canonical factory",
  canonicalImpostor: "Token address ≠ canonical (possible impostor)",
  siblingVouched: "Vouched by a verified cross-source sibling",
  priceDeviation: "CG/DEX price deviation exceeds tolerance",
  highConfidence: "All fences passed with high confidence",
  belowAutoVerifyBar: "Meets some fences, below the auto-verify bar",
};
