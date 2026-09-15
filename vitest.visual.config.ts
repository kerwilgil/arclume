import { defineConfig } from "vitest/config";

/**
 * Chromium Visual QA suite (Phase 6). Real headless browser execution �?" keep it
 * separate from `npm test` so the fast suite stays browser-free. Requires
 * `npx playwright install chromium` (CI: `--with-deps chromium`).
 *
 * Runs single-threaded: each spec drives its own Chromium instance and the
 * machine should not fan out N browsers at once.
 *
 * Timeout policy:
 * - testTimeout: 300s to accommodate long E2E flows (web.e2e.test.ts uses 300s LONG_OP_TIMEOUT)
 * - hookTimeout: 180s for beforeAll/afterAll browser/server setup
 */
export default defineConfig({
  test: {
    include: ["tests/visual/**/*.test.ts"],
    environment: "node",
    reporters: ["default"],
    testTimeout: 300_000,
    hookTimeout: 180_000,
    pool: "forks",
    fileParallelism: false,
  },
});
