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
): Promise<ExtendedSessionUser | null> {
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
