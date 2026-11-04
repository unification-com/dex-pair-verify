// lib/recheck.ts
// How long the pipeline's batch passes leave a token or pair before checking it
// again (env, in days; 0 = re-check everything every run). Shared by the
// pipeline passes and the identity back-off.

const daysEnv = (name: string, fallback: number): number =>
  Math.max(0, Number(process.env[name] ?? fallback)) * 86_400;

// PIPELINE_RECHECK_DAYS (default 7): the canonical / factory / scam passes' window,
// and the first step of the identity back-off.
export const RECHECK_TTL_S = daysEnv("PIPELINE_RECHECK_DAYS", 7);

// PIPELINE_ENRICH_RECHECK_DAYS (default 30): the review-enrich pass's own, longer
// window. Its scans are decision support for the review queue, and a queued
// token's security data barely changes week to week, so a weekly re-scan of the
// whole queue was mostly repeat calls.
export const ENRICH_RECHECK_TTL_S = daysEnv("PIPELINE_ENRICH_RECHECK_DAYS", 30);
