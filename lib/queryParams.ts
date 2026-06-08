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
