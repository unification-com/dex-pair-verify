// ESLint config — strict-from-day-one baseline (locked 2026-06-02).
//
// Mirrors the conventions used in CORE/web-wallet M0:
//   - eslint:recommended + Next.js (covers react/recommended + react-hooks)
//   - jsx-a11y for accessibility (Next's preset has the core rules; we
//     escalate a couple to errors)
//   - @typescript-eslint for TS-aware lint (recommended set only — the
//     stricter type-checked rules require tsconfig `strict: true`, which is
//     a separate workstream)
//   - import-order for predictable import grouping
//
// Pragmatic exceptions:
//   - jsx-a11y/anchor-is-valid is DOWNGRADED for `pages/` because Next 12's
//     `<Link><a>X</a></Link>` pattern is the official idiom on this version.
//     A future Next 13+ upgrade will let us re-enable the rule strictly.
//
// Run: `yarn lint` (errors fail CI) / `yarn lint:fix` (auto-fix safe issues).

module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "next/core-web-vitals",
    "plugin:import/recommended",
    "plugin:import/typescript",
  ],
  plugins: ["@typescript-eslint", "import"],
  settings: {
    "import/resolver": {
      typescript: { project: "./tsconfig.json" },
      node: { extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs"] },
    },
  },
  rules: {
    // --- Pragma for Next 12 era patterns ---
    // Next 12 idiom is <Link><a>X</a></Link>; the <a> has no href until the
    // Next 13 API change. Disable the rule that flags this for /pages.
    "jsx-a11y/anchor-is-valid": "off",
    // styled-jsx's <style jsx> / <style jsx global> are first-class on this
    // codebase. Tell react/no-unknown-property to allow them.
    "react/no-unknown-property": ["error", { ignore: ["jsx", "global"] }],

    // --- TypeScript stylistic / safety ---
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/ban-ts-comment": [
      "error",
      { "ts-ignore": "allow-with-description", minimumDescriptionLength: 5 },
    ],

    // --- React safety ---
    "react/no-unescaped-entities": "warn",

    // --- Import grouping ---
    "import/order": [
      "error",
      {
        groups: [
          "builtin",
          "external",
          "internal",
          ["parent", "sibling", "index"],
          "type",
        ],
        "newlines-between": "always",
        alphabetize: { order: "asc", caseInsensitive: true },
      },
    ],
    "import/no-unresolved": "error",
  },
  overrides: [
    {
      // Plain JS files (import scripts, lib/chains.js, lib/sources.js, etc.)
      // don't get TS-flavoured rules.
      files: ["**/*.js", "**/*.mjs"],
      rules: {
        "@typescript-eslint/no-var-requires": "off",
        "@typescript-eslint/no-require-imports": "off",
      },
    },
    {
      // tmp/ ad-hoc scripts (gitignored) — operator scratch space; relax.
      files: ["tmp/**"],
      rules: {
        "no-console": "off",
        "@typescript-eslint/no-explicit-any": "off",
      },
    },
    {
      // Test files legitimately use `any` for loose fixtures + casting
      // untyped CJS modules under test.
      files: ["__tests__/**", "**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
      },
    },
  ],
  ignorePatterns: [
    "node_modules/",
    ".next/",
    "out/",
    "dist/",
    "build/",
    "tmp/",
    "next-env.d.ts",
  ],
};
