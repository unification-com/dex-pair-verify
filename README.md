# OoO Pair Verification

Simple, no-frills tool used internally for manual and automated verification of DEX pairs.

Verified pairs are exported and used by OoO clients for AdHoc queries

```bash
nvm use
yarn install
yarn prisma db push
yarn prisma generate
node import/geckoterminal.js
node import/graphql.js
node import/check_gecko.js
node import/find_duplicates.js
yarn run dev
```

Note: Use `yarn prisma db push --force-reset` to delete & recreate DB
