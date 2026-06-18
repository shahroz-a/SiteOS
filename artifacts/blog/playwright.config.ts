import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests run against the running dev workflows through the shared proxy.
 * Both the blog (`/blog/`) and the API server (`/api`) are served via
 * `http://localhost:80`. Override with BLOG_E2E_BASE_URL if needed.
 *
 * The `GET /posts/{slug}` endpoint fires several sequential DB queries and can
 * take a few seconds, so timeouts are generous and tests run serially with a
 * single worker to avoid exhausting the Supabase session pooler.
 */
const baseURL = process.env.BLOG_E2E_BASE_URL ?? "http://localhost:80";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
