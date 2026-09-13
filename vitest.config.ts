import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Fast unit + integration suite. Browser-free: the Chromium Visual QA suite
 * lives under `tests/visual/` and runs via `npm run test:visual`
 * (`vitest.visual.config.ts`).
 *
 * `tests/web/**` covers the Web UI's i18n/theme/preferences logic and a few
 * component-level renders (jsdom, opted in per-file via a
 * `// @vitest-environment jsdom` pragma — the default environment below stays
 * "node" for everything else). The React plugin here only affects how these
 * .tsx test files transform; it has no effect on the plain .ts suite.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["tests/visual/**", "node_modules/**", "dist/**"],
    setupFiles: ["tests/web/helpers/setup-react-act.ts"],
    environment: "node",
    // Archify engine tests spawn the vendored CLI subprocesses; keep headroom
    // for slow CI and busy developer machines.
    testTimeout: 30_000,
    reporters: ["default"],
  },
});
