import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // tsc -b's own output lands in dist/ (test files included, since
    // tsconfig has no reason to exclude them from typechecking) — without
    // this, a local `pnpm build` followed by `pnpm test` double-runs every
    // test, once from src/ and once from the compiled dist/ copy.
    exclude: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
  },
});
