// lib/queryParams.ts
// Shared parsing for the getServerSideProps query string. `req.query` values are
// `string | string[] | undefined` (a repeated key like ?page[]=1 arrives as an
// array), so every read has to be normalised before use.

// A single optional string filter. Treats "", "undefined" and a non-string
// (array) as absent → null.
export const cleanParam = (v: unknown): string | null =>
  typeof v === "string" && v !== "" && v !== "undefined" ? v : null;

// A 1-based page number, clamped to a finite integer ≥ 1. Guards the Prisma
// `skip` against `?page=abc` / `?page[]=1` (which would otherwise make
// Number(...) NaN → skip:NaN → an uncaught Prisma error → HTTP 500).
export const pageParam = (v: unknown): number => {
  const n = Math.floor(Number(Array.isArray(v) ? v[0] : v));
  return Number.isFinite(n) && n >= 1 ? n : 1;
};

// A list page's href: the non-empty filters in the given order, then the page when
// it's past the first. The inverse of the parsing above.
export const listHref = (path: string, params: Record<string, string | null | undefined>, page = 1): string => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
};
