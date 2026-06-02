// Bearer-token auth for the export API (A.6.1). EXPORT_API_TOKEN is a
// comma-separated allow-list so the operator can rotate tokens without
// downtime. The parse + allow-list checks are split out pure for testing.

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

export const isAllowedToken = (token: string | null): boolean =>
  token !== null && allowedTokens().includes(token);

export const checkBearerToken = (req: NextApiRequest): boolean =>
  isAllowedToken(parseBearer(req.headers.authorization));

// First chars only — for request logging, never log the full secret.
export const tokenPrefix = (token: string | null): string =>
  token ? `${token.slice(0, 6)}…` : "none";
