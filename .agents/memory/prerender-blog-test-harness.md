---
name: Prerender-blog test harness
description: How the blog static-SEO prerender runner is tested, and the import-time env constraint that shapes the test.
---

The DB-driven prerender runner (`scripts/src/prerender-blog.ts`) is covered by an
integration test under `scripts/src/prerender/__tests__/` with its own in-memory
Drizzle fake (`fakeDb.ts`, select/from/where + and/eq/inArray, plus a
`control.failTables` set to inject per-table query failures). Same fake-Drizzle
philosophy as the read-API and payload harnesses (hermetic, no real pooler).

**Why a refactor was needed:** the runner used to call `main()` unconditionally
at import, which would run the CLI (and `process.exit`) inside the test. It now
exports `run`/`main` and guards execution behind an `isEntrypoint` check
(`process.argv[1]` resolved === module URL), mirroring `export-payload.ts`. Apply
this guard to any script you want to import in a test.

**Non-obvious test constraint:** `DIST_DIR` is computed *once* from
`process.env.BLOG_DIST` at module import, not per call. The test must set
`BLOG_DIST` (and `DATABASE_URL`) **before** the dynamic `await import(...)`, and
reuse a single temp dir (reset in `beforeEach`) rather than a fresh dir per test.

**Graceful-degradation coverage:** missing `DATABASE_URL` and a mid-run DB error
both make `main()` warn and resolve (exit 0); a JSON-LD batch failure is caught
inside the runner so article tags still ship without the structured-data block.
