---
name: Playwright Chromium on Replit
description: How to get a working Chromium for Playwright in this Replit/NixOS environment.
---

# Getting Playwright Chromium to run on Replit

`playwright install chromium` (the bundled-browser download) **stalls/hangs here** — the download CDN is blocked by the package firewall (empty log, zero bytes, never completes). Do not wait on it.

**Working path:** install Chromium via Nix and point Playwright at it.
- `installSystemDependencies({ packages: ["chromium"] })` (Nix attr is `chromium`).
- Resolve the binary with `which chromium` (a `/nix/store/...-chromium-*/bin/chromium` path).
- Launch with `chromium.launch({ executablePath, args: ["--no-sandbox","--disable-dev-shm-usage","--disable-gpu"] })`. Verified working (Chromium 138, headless, real navigation).

**Why:** Replit's package firewall blocks the Playwright browser CDN; Nix provides a runnable Chromium with all shared libs already wired.

**How to apply:** Any Playwright/crawler code that must run a real browser in this env should accept an `executablePath` (e.g. from a `CHROMIUM_PATH` env) instead of relying on Playwright's bundled download. Note the crawler's `crawler/browser.ts` currently calls `chromium.launch()` with no `executablePath`, so it silently falls back to HTTP here (its launch throws → caught → returns null).
