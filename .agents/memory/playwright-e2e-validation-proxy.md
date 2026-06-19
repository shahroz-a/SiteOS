---
name: Playwright e2e as a validation step (shared-proxy monorepo)
description: How to make a browser e2e suite self-bootstrap its services so it can run as an automated validation gate, not just by hand.
---

# Wiring a Playwright e2e suite into a validation gate

A CMS two-tab e2e suite proved real cross-tab `localStorage` sync but only ran by
hand, so regressions could ship. To make it an automated check it had to boot its
own services.

## Key facts about this environment
- The shared reverse proxy at `localhost:80` is **always listening** (container
  infra), but returns **502** when the backing artifact services are down. So
  routes are known; only the backends need starting.
- Backing services run on their artifact.toml `localPort`s (api-server 8080, CMS
  vite 23740) and the proxy maps `/api` and `/cms/` to them. Browser tests must go
  through `localhost:80`, never the raw ports (proxy does cross-service routing).

## The pattern that works
- Add Playwright `webServer: [...]` entries that run each service's dev command
  with the right `env` (`PORT`, plus `BASE_PATH` for vite), and set each entry's
  `url` to the **proxy** URL (`http://localhost:80/api/healthz`, `.../cms/`) — poll
  through the proxy so tests only start once the real browser request path is live.
- Use `reuseExistingServer: true`: reuses running dev workflows interactively, and
  cold-boots the services in a bare validation run. Give a generous `timeout`
  (180s) because the api-server dev command rebuilds (esbuild) on start.
- Register the suite as a validation step (validation skill `setValidationCommand`)
  — it lands in `.replit` with `isValidation = true` and runs on task completion.

## Gotchas
- The bash tool caps timeout at **120s**. A cold e2e run (api-server build + browser)
  exceeds it, so a direct `pnpm run test:e2e` from bash gets killed — **but
  playwright detaches and keeps running orphaned**, leaving servers on 8080/23740
  and causing `EADDRINUSE` when you next start the workflow. To verify within budget:
  start the dev workflows first, then run the suite (reuses them, ~60s for 4 tests),
  or run it through the validation harness (`startValidationRun`).
- The bundled Playwright Chromium lacks system libs here; the config already points
  `executablePath` at `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` (Nix Chromium).
