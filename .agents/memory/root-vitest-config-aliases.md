---
name: Root vitest config is standalone; declare path aliases there
description: Why the monorepo's root vitest.config.ts must hand-roll resolve.alias instead of reusing per-package vite configs
---

The repo runs the whole test suite from a single root `vitest.config.ts`
(`pnpm run test` → `vitest run`), with an `include` glob spanning every
package.

**Rule:** any path alias a test relies on (e.g. `@` → an app's `src`) must be
declared directly in the root `vitest.config.ts` `resolve.alias`. You cannot
make vitest reuse the per-package vite configs (via `test.projects` pointing at
`artifacts/*/vite.config.ts`).

**Why:** the per-package vite configs (cms, blog, …) throw at load time when
`PORT` / `BASE_PATH` are unset, which they are under the standalone test runner.
Referencing them from vitest crashes config load. So the root config is
deliberately standalone and must re-declare any aliases itself.

**How to apply:** if a test fails with "Cannot find package '@/...'" or
"Failed to resolve import '@/...'", add the alias to root `vitest.config.ts`
(`path.resolve(import.meta.dirname, "<pkg>/src")`). A global `@` alias is safe
only while exactly one app's tests resolve `@/` — historically only the CMS
tests do (blog/api-server/scripts/lib tests use relative imports). If a second
app's tests start importing `@/`, a single global alias will collide and you'll
need per-project configs (built inline, not by importing the throwing vite
configs).
