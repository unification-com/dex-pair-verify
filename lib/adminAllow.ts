// lib/adminAllow.ts
// The operator allow-list. Keyed on the IMMUTABLE GitHub numeric user id
// (account.providerAccountId) via ALLOWED_GH_IDS — not email, which can be null
// (private-email GitHub accounts) or change. Falls back to the legacy ALLOWED_USERS
// email list when ALLOWED_GH_IDS is unset, so an operator isn't locked out before
// migrating .env. Used by the next-auth signIn (deny non-allowed) + session
// (re-validate) callbacks, so the allow-list is enforced server-side on every
// request — removing an id locks the user out on their next session read.

const splitEnv = (v: string | undefined): string[] =>
  (v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function isAllowedOperator(opts: { githubId?: string | null; email?: string | null }): boolean {
  const allowedIds = splitEnv(process.env.ALLOWED_GH_IDS);
  if (allowedIds.length > 0) {
    return !!opts.githubId && allowedIds.includes(String(opts.githubId));
  }
  // Backwards-compat: no ALLOWED_GH_IDS set → legacy email allow-list.
  return !!opts.email && splitEnv(process.env.ALLOWED_USERS).includes(opts.email);
}
