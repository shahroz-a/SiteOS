---
name: tsc --build buildinfo location & silent no-op
description: Why `tsc --build` can exit 0 yet emit no dist, and where the buildinfo actually lives in this workspace.
---

# `tsc --build` silent no-op after deleting only `dist`

Composite libs here write their incremental state to `lib/<name>/tsconfig.tsbuildinfo`
(next to `tsconfig.json`), **not** inside `dist/`.

**Symptom:** delete `lib/*/dist` (e.g. to force a clean rebuild) but leave
`lib/<name>/tsconfig.tsbuildinfo` in place → `pnpm run typecheck:libs` (`tsc --build`)
exits **0** while emitting **no** `dist/*.d.ts`. `tsc --build` trusts the stale
buildinfo and thinks every project is up to date. Downstream artifacts that reference
the libs then fail with a cascade of `TS6305: Output file ... has not been built from
source file` plus phantom `TS2339`/`TS7006` (everything resolves to `{}`/`any`).

**Why:** a glob like `rm -rf lib/*/.tsbuildinfo` does NOT match
`lib/<name>/tsconfig.tsbuildinfo` (different filename), so the buildinfo survives.

**How to apply:** to force a real rebuild, run `pnpm exec tsc --build --force`, or
delete the `*.tsbuildinfo` files explicitly (`find lib -name '*.tsbuildinfo' -delete`).
Don't trust a green `tsc --build` exit code alone — confirm `lib/<name>/dist/index.d.ts`
exists when you expect emit.
