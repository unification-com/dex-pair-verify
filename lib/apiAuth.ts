// lib/apiAuth.ts
// Shared admin-API auth gate. Replaces the getServerSession + isAuthorised block
// that was duplicated across every gated /api route. Returns the authorised
// user, or writes the 401/403 response and returns null — so callers guard with
//   if (!(await requireAdminApi(req, res))) return;
// Also fixes the latent null-session dereference the inline copies carried (they
// read session.user without checking session was non-null → throws on no session).
import { getServerSession } from "next-auth";

import { authOptions } from "../pages/api/auth/[...nextauth]";
import { ExtendedSessionUser } from "../types/types";

import type { NextApiRequest, NextApiResponse } from "next";

export async function requireAdminApi(
  req: NextApiRequest,
  res: NextApiResponse,
  opts: { methods?: string[] } = {},
): Promise<ExtendedSessionUser | null> {
  // Optional method allow-list (defence-in-depth against CSRF on state-mutating
  // endpoints — they're all POST; SameSite=Lax session cookies already block the
  // cross-site send, this rejects the wrong verb outright). Omitted → no method
  // restriction, for the read-only endpoints (getprices / nav).
  if (opts.methods && !opts.methods.includes(req.method ?? "")) {
    res.setHeader("Allow", opts.methods.join(", "));
    res.status(405).json({ success: false, err: "method not allowed" });
    return null;
  }
  const session = await getServerSession(req, res, authOptions);
  const user = session?.user as ExtendedSessionUser | undefined;
  if (!user) {
    res.status(401).json({ success: false, err: "not authenticated" });
    return null;
  }
  if (!user.isAuthorised) {
    res.status(403).json({ success: false, err: "not authorised" });
    return null;
  }
  return user;
}
