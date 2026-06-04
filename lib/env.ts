// Load .env into process.env at the VERY START of a CLI run, before any other
// module is evaluated. Several lib modules capture env vars EAGERLY at import
// time — notably GECKO_API_KEY in coingecko.ts, which is read once at module
// load to build the CoinGecko rate gate and the `x-cg-demo-api-key` auth header.
// Prisma's own .env autoload runs too late for those: it populates process.env
// only when the client first connects, by which point the eager reads have
// already captured "" (so requests silently fall back to the keyless public
// rate limit). Every import/*.ts entry point imports THIS as its FIRST import,
// ahead of any ./lib import, so the key is present before coingecko.ts reads it.
//
// Deliberately imported only by entry points (never by lib modules), so the test
// runner's own env handling (.env.test via vitest) is never overridden.
import { config } from "dotenv";

config();
