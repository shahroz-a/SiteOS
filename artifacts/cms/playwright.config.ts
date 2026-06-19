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
 *
 * `webServer` below makes the suite self-contained so it can run as an
 * automated validation step (CI-style) without anyone first starting the dev
 * workflows by hand: it boots the api-server (localPort 8080) and the CMS vite
 * dev server (localPort 23740) on the same ports the Replit proxy routes to,
 * then polls those services *through* the shared proxy (`localhost:80`) so the
 * tests only start once the full request path the browser uses is live. When
 * the dev workflows are already running (the interactive case),
 * `reuseExistingServer` short-circuits and no duplicate servers are spawned.
 */
const baseURL = process.env.CMS_E2E_BASE_URL ?? "http://localhost:80";

// The proxy routes /api -> api-server (8080) and /cms/ -> cms vite (23740).
// Keep these in lockstep with the services' artifact.toml localPorts.
const API_SERVER_PORT = process.env.E2E_API_SERVER_PORT ?? "8080";
const CMS_PORT = process.env.E2E_CMS_PORT ?? "23740";

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
  // Boot the services the tests need (through the shared proxy) unless they are
  // already running. Each command starts a service on the same localPort the
  // Replit proxy routes to; the `url` is polled *via the proxy* so we only begin
  // once the real browser request path is live. `reuseExistingServer` makes this
  // a no-op when the dev workflows are already up.
  webServer: [
    {
      command: "pnpm --filter @workspace/api-server run dev",
      url: `${baseURL}/api/healthz`,
      reuseExistingServer: true,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      env: { PORT: API_SERVER_PORT, NODE_ENV: "development" },
    },
    {
      command: "pnpm --filter @workspace/cms run dev",
      url: `${baseURL}/cms/`,
      reuseExistingServer: true,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      env: { PORT: CMS_PORT, BASE_PATH: "/cms/" },
    },
  ],
});
