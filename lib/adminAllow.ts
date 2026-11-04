// lib/adminAllow.ts
// The operator allow-list. Entries may be GitHub numeric user ids OR account
// emails, listed in EITHER ALLOWED_GH_IDS or ALLOWED_USERS — both vars are merged
// and each entry is classified by shape (all-digits → GitHub id, otherwise email),
// so there's no footgun about which variable an id goes in. Prefer ids: the numeric
// id is immutable, whereas an email can be null (private-email GitHub accounts) or
// change. Used by the next-auth signIn (deny non-allowed) + session (re-validate)
// callbacks, so the allow-list is enforced server-side on every request — removing
// an entry locks the user out on their next session read.

const splitEnv = (v: string | undefined): string[] =>
  (v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// A GitHub numeric user id is all digits; an email never is.
const isNumericId = (s: string): boolean => /^\d+$/.test(s);

export function isAllowedOperator(opts: { githubId?: string | null; email?: string | null }): boolean {
  const entries = [...splitEnv(process.env.ALLOWED_GH_IDS), ...splitEnv(process.env.ALLOWED_USERS)];
  const ids = entries.filter(isNumericId);
  const emails = entries.filter((e) => !isNumericId(e));
  if (opts.githubId && ids.includes(String(opts.githubId))) return true;
  if (opts.email && emails.includes(opts.email)) return true;
  return false;
}
