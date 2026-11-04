// Vitest config for INTEGRATION tests (require a live Postgres test DB).
//
// Kept separate from the unit suite (vitest.config.ts) so `yarn test`
// stays DB-free and fast. Run via `yarn test:integration` after
// `yarn db:push:test`.
//
// Single fork, no concurrency: the suite truncates shared tables between
// tests, so parallel workers would race on the same DB.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["**/*.integration.test.{ts,js,mjs}"],
    exclude: ["node_modules/**", ".next/**", "dist/**", "build/**", "tmp/**"],
    setupFiles: ["./__tests__/integration/setup.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    reporters: ["default"],
  },
});
