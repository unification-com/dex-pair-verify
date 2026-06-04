# OoO Pair Verification

Simple, no-frills tool used internally for manual and automated verification of DEX pairs.

Verified pairs are exported and used by OoO clients for AdHoc queries

## API endpoints

There are two surfaces, split by audience:

**Public (ungated) — the supported-pairs catalogue.** What an OoO *user* can query.

- `GET /api/pairs` — JSON list of the queryable pairs (deduped across chains/DEXs
  by canonical key), deepest liquidity first. Carries no trust internals — just
  `base` / `target` symbols, `canonicalKey`, `sources` (backing pool count),
  `chains`, and `totalLiquidityUsd`. Cacheable (`Cache-Control` + `Last-Modified` /
  `If-Modified-Since` 304), light per-IP rate limit, **no auth**. Query format is
  `BASE.TARGET.AD`.

**Gated (provider) — the full trust-weighted feed.** What the `go-ooo` *provider*
pulls. Bearer token (`Authorization: Bearer <EXPORT_API_TOKEN>`):

- `GET /api/export/manifest` — which `(chain, dex)` exports exist + freshness.
- `GET /api/export/{chain}/{dex}` — per-pair verdict, `confidence` trust score,
  `reserveUsd`, and the per-source curation floor. Supports `?ifModifiedSince=<unix>`.

```bash
nvm use
yarn install
yarn prisma db push
yarn prisma generate
node import/import_geckoterminal.js
node import/import_graphql.js
node import/refresh_data.js
node import/find_duplicates.js
yarn run dev
```

Note: Use `yarn prisma db push --force-reset` to delete & recreate DB
