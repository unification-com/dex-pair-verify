// Bearer-token auth for the export API (A.6.1 + T8). Two ways in: a live PROVIDER TOKEN minted by the
// wallet challenge-response (lib/providerAuth — the going-forward path, tied to on-chain provider
// registration), or the static EXPORT_API_TOKEN, now an operator BREAK-GLASS allow-list (lets the
// operator pull the feed without a wallet; comma-separated so it can be rotated without downtime). The
// pure parse + static allow-list checks are split out for testing; authoriseExport is the async gate.

import { timingSafeEqual } from "crypto";

import { lookupLiveToken } from "./providerAuth";

import type { NextApiRequest } from "next";


const allowedTokens = (): string[] =>
  (process.env.EXPORT_API_TOKEN ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

// Extract the token from an `Authorization: Bearer <token>` header.
export const parseBearer = (authHeader: string | undefined): string | null => {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader ?? "");
  return m ? m[1].trim() || null : null;
};

// Constant-time compare (avoid leaking the token via response-timing). Length
// mismatch short-circuits — that only reveals length, not contents.
const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

export const isAllowedToken = (token: string | null): boolean =>
  token !== null && allowedTokens().some((t) => safeEqual(t, token));

export const checkBearerToken = (req: NextApiRequest): boolean =>
  isAllowedToken(parseBearer(req.headers.authorization));

// First chars only — for request logging, never log the full secret.
export const tokenPrefix = (token: string | null): string =>
  token ? `${token.slice(0, 6)}…` : "none";

// Result of an export authorisation: how the caller got in (for logging) + the bound provider wallet
// when it authenticated via wallet-auth. null = unauthorised.
export type ExportPrincipal = { via: "token" | "breakglass"; address?: string; chainId?: number };

// The export-API gate (T8): authorise a request by EITHER a live provider token (the wallet
// challenge-response path) OR the static EXPORT_API_TOKEN operator break-glass. Async because the
// provider-token path is a DB lookup. Returns the principal (for logging) or null when unauthorised.
export async function authoriseExport(req: NextApiRequest, now: number): Promise<ExportPrincipal | null> {
  const bearer = parseBearer(req.headers.authorization);
  if (!bearer) {
    return null;
  }
  // Operator break-glass: the static shared token still works (operator-only; lets the operator pull
  // the feed without a wallet). Checked first + constant-time.
  if (isAllowedToken(bearer)) {
    return { via: "breakglass" };
  }
  // Provider wallet-auth: a live, unexpired, unrevoked token minted by the challenge-response.
  const live = await lookupLiveToken(bearer, now);
  return live ? { via: "token", address: live.address, chainId: live.chainId } : null;
}
