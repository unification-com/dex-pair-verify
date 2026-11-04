// Integration-test setup — runs in each worker BEFORE any test module
// (and therefore before import/db.js instantiates its PrismaClient).
//
// Loads `.env.test` with override so POSTGRES_PRISMA_URL points at the
// dedicated test DB, NOT the dev/prod DB. `import/db.js` reads the env at
// module-load time, so this ordering is load-bearing.

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.test", override: true });

if (!process.env.POSTGRES_PRISMA_URL?.includes("ooo_pairs_test")) {
  throw new Error(
    "Refusing to run integration tests: POSTGRES_PRISMA_URL is not the " +
      "test DB (expected a database named 'ooo_pairs_test'). Check .env.test.",
  );
}
