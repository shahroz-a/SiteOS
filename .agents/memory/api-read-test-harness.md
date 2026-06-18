---
name: Read-API test harness
description: How the read-API (lib/posts + routes) tests fake Drizzle, and the join-eq gotcha that bites fakes.
---

The public read API (`artifacts/api-server/src/lib/posts.ts` + `routes/`) is
covered by vitest tests under `artifacts/api-server/src/**/__tests__/`, sharing an
in-memory Drizzle fake (`src/__tests__/fakeDb.ts`) and seed fixtures
(`src/__tests__/fixtures.ts`). Endpoint tests drive the real express `app` via
supertest. Run with `pnpm run test`.

**Why a fake, not a real DB:** same reason as the crawler harness — the only DB is
the shared Supabase pooler; tests must stay hermetic and fast.

**Join-eq gotcha (the non-obvious one):** Drizzle `innerJoin(t, eq(a.col, b.col))`
passes *two column refs* to `eq` — the right-hand side is NOT a literal. A naive
fake `eq` that treats the second arg as a value silently makes every join return
zero rows. The fake must detect when `eq`'s second arg is a column descriptor and
resolve it against the joined row too. Same applies to any operator comparing two
columns.

**Other fake requirements that production code depends on:** `ilike` (LIKE→regex,
case-insensitive, `%`→`.*`), `inArray`, `and`/`or` (filter falsy conds), nulls-last
ordering for `sql` order keys like `publishedAt desc nulls last`, and a `count(*)`
aggregate detected by a `sql` marker in the projection.

**Fixture ids must be real UUIDs** — the response zod schemas validate `id` fields
with `.uuid()`, so `page-1`-style ids fail `*.parse()` in the route tests.
