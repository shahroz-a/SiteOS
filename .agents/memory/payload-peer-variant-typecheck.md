---
name: Payload deps fork drizzle-orm and vite peer variants (typecheck-only breakage)
description: Why installing Payload into the scripts package breaks typecheck (not runtime) and the contained fixes.
---

# Payload export-loader integration test: peer-variant duplication

Adding Payload (`payload`, `@payloadcms/db-sqlite`, `graphql@16`) to the `scripts`
package to run a real Local-API load test introduces two *peer-variant*
duplications that fail `pnpm run typecheck` while every test still passes at
runtime.

## drizzle-orm: libsql vs pg variant

`@payloadcms/db-sqlite` pulls `@libsql/client`. `drizzle-orm` declares both `pg`
and `@libsql/client` as *optional peers*, so pnpm builds one virtual store dir
per peer combination. Once `@libsql/client` is in `scripts`' graph, `scripts`'
direct `drizzle-orm` resolves to the `...@libsql+client...` variant while
`@workspace/db` (and `api-server`) stay on the pg-only variant. `eq()`/`asc()`
from one variant applied to `@workspace/db` columns from the other → TS2769
("private property `shouldInlineParams`/`config` ... separate declarations").

**Fix (typecheck-only, one file):** in `scripts/tsconfig.json` add
`compilerOptions.paths`: `"drizzle-orm": ["../lib/db/node_modules/drizzle-orm"]`.
That symlink is the stable pg variant `lib/db` uses, so columns and operators
share one type identity. vitest has no tsconfig-paths plugin, so runtime
resolution (and the existing `vi.mock("drizzle-orm")` in the scripts tests) is
untouched.

**Why not the obvious alternatives:**
- Adding `@libsql/client` to `lib/db` just moves the conflict to `api-server`
  (its operators stay pg-only vs lib/db's now-both-variant tables).
- Switching source files to import operators from `@workspace/db` breaks the
  existing tests that `vi.mock("drizzle-orm")` — the mock would stop intercepting
  the re-exported operators.

## tsx: forks vite into two variants

`payload` pins `tsx@4.22.4` exactly. `tsx` is an optional peer of `vite`, so two
tsx versions (4.21.0 + 4.22.4) fork `vite@7` into two peer variants, which breaks
`mockup-sandbox`'s typecheck ("two different types named ViteBuilder/Plugin").

**Fix:** `pnpm-workspace.yaml` `overrides: { tsx: 4.21.0 }` (the version
everything else already used; satisfies the `^4.21.0` consumers). A `tsx: 4.22.4`
override does NOT collapse it because the pre-existing
`@esbuild-kit/esm-loader: npm:tsx@^4.21.0` alias keeps 4.21.0 alive. Payload's
`tsx` is only used by its CLI/bundler, not the Local API the test uses, so
forcing 4.21.0 is safe.

**General lesson:** when a new dep makes a previously-green typecheck fail in
*unrelated* packages, suspect optional-peer variant duplication (drizzle-orm,
vite, etc.), not the new code. Diff the lockfile for the forked peer and dedupe
via override or a tsconfig `paths` redirect rather than restructuring imports.
