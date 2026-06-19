---
name: drizzle ANY(array) raw-sql binding
description: Interpolating a JS array into a raw drizzle sql template breaks `= ANY(...)`; use IN + sql.join.
---

Interpolating a JS array directly into a raw drizzle `sql` template does NOT
bind a Postgres array. drizzle expands the array into a parenthesized scalar
tuple, so `WHERE col = ANY(${urls})` renders as `ANY(($1, $2, ...))` and
Postgres throws `42809` ("op ANY/ALL (array) requires array on right side").
`IN (${urls})` is equally broken — it renders `IN (($1, $2))` (a row
constructor), not a value list.

**Why:** this is core drizzle sql-template behavior (same across pg / @libsql
peer variants), so it fails identically in production and tests. It is easy to
miss because the same query verifies fine when pasted straight into psql (where
`ANY('{...}')`/`IN (...)` use literals), so a "verified manually against the
live DB" claim can hide it.

**How to apply:** for a dynamic list in a raw `sql` template, flatten the
params yourself:
`WHERE col IN (${sql.join(urls.map((u) => sql`${u}`), sql`, `)})`
→ renders `IN ($1, $2, ...)`, correctly parameterized. (Guard against an empty
list first, since `IN ()` is invalid.) Or, if you can reference the real column
object (not a table alias), use the `inArray()` helper instead of raw sql.
