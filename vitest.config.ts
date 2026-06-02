// Vitest config (scaffold landed in commit 6; populated in subsequent
// test commits per the A.0 hygiene-pass ledger).
//
// Convention: explicit imports of `describe` / `it` / `expect` from
// "vitest" in every test file. Avoids globals pollution + keeps ESLint
// happy without needing per-file env overrides.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default environment: node (covers lib/, import scripts).
    // React component tests can opt into jsdom per-file via
    //   // @vitest-environment jsdom
    // header — kept as opt-in until M14-ish component tests land.
    environment: "node",
    globals: false,
    include: ["**/*.{test,spec}.{ts,tsx,js,mjs}"],
    exclude: ["node_modules/**", ".next/**", "dist/**", "build/**", "tmp/**"],
    reporters: ["default"],
  },
});
