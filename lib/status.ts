// Shared helpers for the verification-status enum.
//
// "Verified" is no longer a single status: a pair/token counts as verified
// when the operator confirmed it (ManualVerified) OR the verdict engine
// auto-confirmed it (AutoVerified). These are the rows that get exported to
// go-ooo and used in the OoO price simulation. Keep that set in one place so
// the export filter, the price-test gate and the UI never drift.

import { TokenPairStatus } from "../types/types";

export const VERIFIED_STATUSES: readonly TokenPairStatus[] = [
  TokenPairStatus.ManualVerified,
  TokenPairStatus.AutoVerified,
];

export const isVerifiedStatus = (status: TokenPairStatus): boolean =>
  VERIFIED_STATUSES.includes(status);

// Every valid status value, for validating a `?status=` query param before it
// reaches Prisma. An unrecognised value passed straight into a `where: { status }`
// throws (status is a DB enum) → HTTP 500, so coerce/whitelist at the boundary.
const STATUS_VALUES = Object.values(TokenPairStatus) as string[];

export const isStatus = (v: unknown): v is TokenPairStatus =>
  typeof v === "string" && STATUS_VALUES.includes(v);

// A query param coerced to a valid status, falling back to `fallback` when it's
// absent or not a recognised enum value.
export const coerceStatus = (v: unknown, fallback: TokenPairStatus): TokenPairStatus =>
  isStatus(v) ? v : fallback;
