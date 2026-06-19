import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests for the CMS run against the running dev workflows through the shared
 * proxy. The CMS (`/cms/`) and the API server (`/api`) are both served via
 * `http://localhost:80`. Override with CMS_E2E_BASE_URL if needed.
 *
 * The CMS is gated behind Replit Auth (OIDC), which cannot be driven from a
 * standalone browser here. Instead `e2e/global-setup.ts` seeds an admin user +
 * a session row directly (the same unsigned `sid`-cookie session mechanism the
 * server uses) and writes a Playwright storageState so every test starts
 * authenticated as an admin. No application auth code is bypassed or stubbed.
 *
 * The editor's source endpoint fires several sequential DB queries and can take
 * a few seconds, so timeouts are generous and tests run serially with a single
 * worker to avoid exhausting the DB connection pool.
 */
const baseURL = process.env.CMS_E2E_BASE_URL ?? "http://localhost:80";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    storageState: "./e2e/.auth/state.json",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    // The bundled Playwright Chromium is missing system libs in this env; use
    // the Nix-provided Chromium when present (set by the Replit environment).
    launchOptions: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
