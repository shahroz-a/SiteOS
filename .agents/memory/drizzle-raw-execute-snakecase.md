---
name: db.execute raw rows are snake_case
description: Drizzle db.execute(sql`…RETURNING *`) returns driver snake_case columns; casting to a camelCase row type is silently unsound.
---

# Raw `db.execute` returns snake_case columns

`db.execute(sql`…`)` runs raw SQL and returns the **driver's** result rows, whose
keys are the literal Postgres column names (snake_case, e.g. `discovered_from`,
`started_at`). It does NOT apply Drizzle's schema column mapping the way the query
builder (`db.select()` / `.returning()`) does.

So `return result.rows as CrawlQueueItem[]` is a **lie**: any field whose camelCase
name differs from its DB column reads back `undefined` at runtime. Fields that
happen to be identical in both cases (`id`, `url`, `status`) work, which masks the
bug — only the differing field (`discoveredFrom`) is silently `undefined`.

**Why it matters:** the crawler's `claimBatch` did this. `item.discoveredFrom` was
always `undefined`, so the dead-link/frontier skip classification
(`isFrontierDiscovered(item.discoveredFrom)`) always evaluated false and every
frontier 404 was recorded as `failed` ("processing failed") instead of `skipped`.
TypeScript could not catch it — the unsound cast suppresses the type error.

**How to apply:** when you must use raw `db.execute` with `RETURNING *` (e.g. the
`FOR UPDATE SKIP LOCKED` claim pattern that the query builder can't express),
map the rows snake→camel before casting, or alias every column in `RETURNING`.
Prefer the query builder's `.returning()` (which maps for you) whenever the query
shape allows it.
