# OoO Pair Verification

Simple, no-frills tool used internally for manual and automated verification of DEX pairs.

Verified pairs are exported and used by OoO clients for AdHoc queries

```bash
nvm use
yarn install
npx prisma db push
npx prisma generate
node import/geckoterminal.js
node import/graphql.js
yarn run dev
```
