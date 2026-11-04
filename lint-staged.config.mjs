// lint-staged config.
//
// ESLint 8 emits a "File ignored because of a matching ignore pattern"
// warning when a staged file is in `.eslintignore` (e.g. a bug-territory
// file pending its fix). With `--max-warnings 0` that warning fails the
// commit. ESLint 8 has no `--no-warn-ignored` flag (added in v9), so we
// filter the ignored files out before invoking ESLint — the documented
// lint-staged recipe.

import { ESLint } from "eslint";

const lintNonIgnored = async (files) => {
  const eslint = new ESLint();
  const ignored = await Promise.all(files.map((f) => eslint.isPathIgnored(f)));
  const toLint = files.filter((_, i) => !ignored[i]);
  if (toLint.length === 0) {
    return [];
  }
  return [`eslint --max-warnings 0 ${toLint.map((f) => `"${f}"`).join(" ")}`];
};

const config = {
  "*.{ts,tsx,js,mjs,jsx}": lintNonIgnored,
};

export default config;
