---
name: Playwright browser deps on NixOS
description: Why downloaded Chromium fails to launch in this repl and how to fix it.
---

Playwright's downloaded Chromium (`chrome-headless-shell`) is a generic FHS Linux
binary; on this NixOS container it fails to launch with `error while loading
shared libraries: <lib>.so: cannot open shared object file`. The error surfaces
one missing lib at a time (first `libglib-2.0.so.0`, then `libgbm.so.1`, etc.).

**Fix:** install the Nix system deps via `installSystemDependencies` (NOT apt
names). A working set for Chromium: `glib nss nspr atk at-spi2-atk at-spi2-core
cups dbus libdrm gtk3 pango cairo expat alsa-lib mesa nghttp2 xorg.libX11
xorg.libXcomposite xorg.libXdamage xorg.libXext xorg.libXfixes xorg.libXrandr
xorg.libxcb libxkbcommon libgbm`. Note `libxkbcommon` and `libgbm` are top-level
(no `xorg.` prefix); `xorg.libxkbcommon` does not exist in the index.

**How to apply:** when a committed Playwright suite must actually run in-repl (a
code-review validator may require committed specs, not just on-demand runTest),
install these once, then run `pnpm exec playwright test` from the artifact dir.

**Gotchas while running:**
- The bash tool kills the process at its timeout and `tail`-piped stdout is lost
  on SIGKILL. Redirect to a file (`> /tmp/out 2>&1`) and `grep` it after, or run
  one spec file per call — the full blog suite (workers:1) exceeds ~115s.
- `waitUntil:"networkidle"` is unreliable here; prefer `domcontentloaded` plus an
  explicit `waitFor` on the expected element.
- This blog's read API (`GET /posts/{slug}` etc.) shares the Supabase session
  pooler; repeated rapid test runs exhaust it and pages render their loading
  fallback (e.g. category heading shows the raw slug, 0 article cards). That is
  pool exhaustion, not a test bug — pause to let it recover and verify at low
  concurrency.
