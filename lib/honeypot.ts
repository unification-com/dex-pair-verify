// lib/honeypot.ts
// Honeypot.is buy/sell simulation — a SECOND scam source that covers tokens GoPlus
// doesn't index (it simulates an actual swap rather than reading a security DB, so
// it answers where GoPlus is blank — e.g. fresh tokens on Base). Free, no API key.
// Decision support, never an auto-verify gate. Degrades to a null-ish result on any
// failure / unsupported chain so the caller never blocks.

import { fetchWithTimeout } from "./fetchTimeout";

export type HoneypotResult = {
  isHoneypot: boolean | null;
  buyTax: number | null; // %
  sellTax: number | null; // %
  risk: string | null; // honeypot.is summary risk: low / medium / high / …
  reason: string | null; // honeypotResult.honeypotReason when flagged
  error: string | null;
};

const blank = (error: string | null): HoneypotResult => ({ isHoneypot: null, buyTax: null, sellTax: null, risk: null, reason: null, error });

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function fetchHoneypot(chainId: number, address: string): Promise<HoneypotResult> {
  const res = await fetchWithTimeout(`https://api.honeypot.is/v2/IsHoneypot?address=${address}&chainID=${chainId}`, { headers: { Accept: "application/json" } });
  if (!res) return blank("no response / timeout");
  if (!res.ok) return blank(`honeypot.is ${res.status}`);
  let j: Record<string, unknown>;
  try {
    j = await res.json();
  } catch {
    return blank("non-JSON response");
  }
  // honeypot.is returns { error: "..." } for unsupported chains / un-simulatable tokens.
  if (j?.error) return blank(String(j.error));

  const hr = (j?.honeypotResult ?? {}) as Record<string, unknown>;
  const sim = (j?.simulationResult ?? {}) as Record<string, unknown>;
  const summary = (j?.summary ?? {}) as Record<string, unknown>;
  return {
    isHoneypot: typeof hr.isHoneypot === "boolean" ? hr.isHoneypot : null,
    buyTax: numOrNull(sim.buyTax),
    sellTax: numOrNull(sim.sellTax),
    risk: typeof summary.risk === "string" ? summary.risk : null,
    reason: typeof hr.honeypotReason === "string" ? hr.honeypotReason : null,
    error: null,
  };
}
