// First-party identity source. Unification's own tokens (FUND / xFUND / FUNDx,
// see lib/firstParty.ts) are trusted unconditionally — a new self-sufficient
// identity category so they're always "identified", even on chains CoinGecko
// doesn't list (Polygon fxFUND, etc.). Pure + instant (an allowlist lookup, no
// network), so it runs first in the resolver.

import { isFirstParty } from "../../firstParty";
import { IdentitySignal } from "../types";

export function firstPartyIdentity(chain: string, address: string): IdentitySignal {
  const yes = isFirstParty(chain, address);
  return {
    source: "first-party",
    category: "first-party",
    confirmed: yes,
    detail: yes ? "Unification first-party token (allowlisted)" : "not a first-party token",
  };
}
