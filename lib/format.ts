// lib/format.ts
// Shared display formatters. These were copy-pasted into every pair/token page,
// the dashboard and the price-test components (and had drifted on fraction
// digits); the single definition lives here so they can't diverge again.

// Compact USD: $1.23B / $4.56M / $7.8k / $9.01. Null/undefined → em dash.
export const usd = (n: number | null | undefined): string => {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return "$" + (n / 1e3).toFixed(1) + "k";
  return "$" + n.toFixed(2);
};

// Grouped number (en-GB). Null/undefined → em dash. `maxFrac` defaults to 0
// (counts); the detail pages bind 2, the price-test grid binds 4.
export const num = (n: number | null | undefined, maxFrac = 0): string =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { maximumFractionDigits: maxFrac }).format(n);

// Abbreviate a hex string (address / tx hash / requestId): 0x1234…cdef. Null/short → as-is.
export const shortHex = (h: string | null | undefined, lead = 6, tail = 4): string =>
  !h ? "—" : h.length <= lead + tail + 1 ? h : `${h.slice(0, lead)}…${h.slice(-tail)}`;

// Format an xFUND base-unit amount (9 decimals; the OoO fee/withdrawable unit). Accepts a uint256 string or
// a number. e.g. "100000" → "0.0001 xFUND".
export const xfund = (base: string | number | null | undefined, withSymbol = true): string => {
  if (base == null) return "—";
  return num(Number(base) / 1e9, 9) + (withSymbol ? " xFUND" : "");
};

// Format a wei amount (18 decimals) as ETH (display precision; provider gas balances are small). No symbol —
// callers add the native-currency label.
export const ethAmt = (wei: string | null | undefined, dp = 4): string =>
  wei == null ? "—" : (Number(wei) / 1e18).toFixed(dp);

// Readable label for an unmapped chain/dex slug: "aerodrome_slipstream" →
// "Aerodrome Slipstream", "camelot_v3" → "Camelot V3". Version tokens (v2/v3…)
// are upper-cased; every other word is title-cased. Used as the fallback in
// ChainName / DexName so a newly-onboarded source never renders blank.
export const humaniseSlug = (slug: string): string =>
  (slug || "")
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => (/^v\d+$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

// Human age from a unix-seconds timestamp: "6h", "3d", "2w 1d", "5mo", "1y 2mo".
export const ageStr = (ts: number | null): string => {
  if (!ts) return "unknown";
  const days = Math.max(0, Date.now() / 1000 - ts) / 86400;
  if (days < 1) return Math.max(1, Math.round(days * 24)) + "h"; // < 1 day → hours
  if (days < 7) return Math.round(days) + "d"; // < 1 week → days
  if (days < 30.44) {
    // < 1 month → weeks + days
    const w = Math.floor(days / 7);
    const d = Math.round(days - w * 7);
    return d > 0 ? `${w}w ${d}d` : `${w}w`;
  }
  const months = Math.floor(days / 30.44);
  if (months < 12) return months + "mo"; // 1–12 months → months
  const y = Math.floor(months / 12); // > 12 months → years + months
  const mo = months - y * 12;
  return mo > 0 ? `${y}y ${mo}mo` : `${y}y`;
};
