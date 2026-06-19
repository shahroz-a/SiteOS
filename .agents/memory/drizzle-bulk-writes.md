---
name: Drizzle bulk-write gotchas (data-only backfills)
description: Runtime traps when writing large data-only backfills with drizzle-orm against the pg pool — array params and partial-set cleanup.
---

# Drizzle bulk-write gotchas

## `sql` template + a JS array does NOT make a single array param
Interpolating a JS array into a drizzle `sql` template expands it into a
comma-separated `ANY($1,$2,…)` list, which Postgres rejects with **error 42809**
(`op ANY/ALL (array) requires array on right side`) when you meant one array
operand.
**Fix:** use the `inArray(col, ids)` helper for `IN (…)` membership, or build an
explicit `sql` set-expression — never drop a raw JS array into `... = ANY(${arr})`.
**Why:** the template flattens arrays into individual bind params; there is no
array boxing. This bit the category temp-slug step in `derive-categories.ts`.
**How to apply:** any time you reach for `ANY(...)` / `IN (...)` over a JS array
in a drizzle `sql\`\`` template, switch to `inArray` instead.

## A partial-set backfill must also clean the complement set
A backfill that rewrites links only for its *positive* assignment set (the rows
it computed a value for) leaves **stale rows on the negative set** — posts that
got no assignment keep whatever `primary_category_id` / `page_categories` an
earlier crawl wrote. They then resurface (e.g. a junk category badge, or a junk
row leaking into a filtered list endpoint).
**Why:** "replace links for affected posts" ≠ "make every post correct"; the
uncategorized remainder is invisible to a positive-only rewrite.
**How to apply:** in the same transaction, also NULL the column and delete links
for the published rows NOT in the assignment set, then assert a postcondition
(e.g. `count(primary IS NOT NULL) == assignments` AND zero links on
uncategorized rows) so a future re-crawl can't silently reintroduce stale state.
