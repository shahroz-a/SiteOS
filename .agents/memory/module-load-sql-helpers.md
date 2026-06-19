---
name: Module-load-time sql.join/sql.raw hazard
description: Why drizzle sql.join/sql.raw must not be touched at module top-level under vitest/tsx
---
Under vitest/tsx CJS↔ESM interop, drizzle-orm's `sql` tag is callable at import time,
but its attached helpers (`sql.join`, `sql.raw`, `sql.empty`, etc.) may not be assigned
yet during a module's top-level evaluation. Touching them at module-eval throws
`sql.join is not a function` and the whole module fails to load — cascading to every
suite that transitively imports it (e.g. all route suites via routes/index.ts).

**Why:** every working `sql.join`/`sql.raw` usage in the repo (lib/db shapes, media.ts)
sits *inside a function* (runtime), so the helpers are resolved after the module graph
is fully initialized. The esbuild bundle (prod server) is unaffected — only vitest/tsx.

**How to apply:** never compute SQL with `sql.join`/`sql.raw` in a module-level `const`.
Wrap it in a lazily-memoized function (`let cache; fn() { return (cache ??= sql.join(...)) }`)
so the property access happens at call time. The bare `sql\`...\`` template tag at module
top-level is fine — only the attached `.join`/`.raw`/etc. property accesses are the hazard.
