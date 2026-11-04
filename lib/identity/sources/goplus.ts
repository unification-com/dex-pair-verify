// GoPlus positive-identity source (T1). Reuses the GoPlus token-security data
// scamCheck already fetches/stores (DRY — one fetch feeds both the scam fence
// and this identity signal) and derives a *positive* legitimacy signal from it.
//
// Pure: takes the security object, returns a signal. The fetch (or reuse of
// stored data) is the resolver's job.

import { TokenSecurity } from "../../scamCheck";
import { IdentitySignal } from "../types";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

// A token needs at least this many holders (with verified source) to count as a
// positive identity signal — a real, used token, not a freshly-minted spoof.
const HOLDER_FLOOR = 100;

// Positive identity from GoPlus. Strongest: presence on GoPlus's curated trust
// list. Otherwise: an open-source (explorer-verified) contract with a
// non-trivial holder base is very likely a genuine token rather than an impostor
// of a known symbol. Deliberately conservative — false positives here are capped
// by the ≥2-independent-categories rule (a token list must also vouch).
export function deriveGoplusIdentity(security: TokenSecurity | null): IdentitySignal {
  const base = { source: "goplus", category: "security-api" as const };
  if (!security) {
    return { ...base, confirmed: false, detail: "no GoPlus data" };
  }

  if (str(security.trust_list) === "1") {
    return { ...base, confirmed: true, detail: "on GoPlus trust list" };
  }

  const openSource = str(security.is_open_source) === "1";
  const holders = parseInt(str(security.holder_count), 10);
  const wellHeld = Number.isFinite(holders) && holders >= HOLDER_FLOOR;

  if (openSource && wellHeld) {
    return { ...base, confirmed: true, detail: `open-source, ${holders} holders` };
  }

  return {
    ...base,
    confirmed: false,
    detail: openSource ? "open-source but thin holder base" : "not open-source / not trusted",
  };
}
