---
name: Crawler test harness
description: How the crawler extraction/idempotency tests are wired (vitest + in-memory db fake) and why.
---

The crawler pipeline (extract/normalize/assemble/store) is covered by vitest tests
under `scripts/src/crawler/__tests__/`. Run with `pnpm run test` (root) — also
registered as the `test` validation.

**Pure-vs-DB split:**
- extract/normalize/assemble are pure and tested directly against a saved HTML
  fixture; determinism is proven by assembling the same fixture twice and asserting
  identical `contentHash` + deep-equal `componentTree`.
- `storePage` touches the DB, so the store test mocks `@workspace/db` (and
  `drizzle-orm`'s `eq`/`desc`) with a tiny in-memory fake that implements the
  thenable insert/select/delete builder chain and tracks per-table row counts.

**Why a fake instead of a real/test DB:** the only DB is the shared Supabase
pooler; hitting it from tests would pollute real data and needs network. The fake
keeps the idempotency test hermetic and fast.

**How to apply (idempotency):** build the baseline with current code in the same
test (store once), then store the identical assemble again and assert
`changed:false`, no new `page_versions` row, and unchanged child-row insert counts.
Never assert against pre-existing DB rows (see crawler-content-hash-idempotency.md).
To mutate content for a change-detection test, edit the `<h1>` (drives `title` →
`contentHash`); a bare string replace hits the `<title>` tag first and won't change
the hash.
