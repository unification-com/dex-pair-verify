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
