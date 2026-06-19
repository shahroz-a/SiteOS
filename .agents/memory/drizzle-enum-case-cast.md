---
name: Drizzle CASE/expression assignment to a pgEnum column
description: Assigning a SQL CASE (or any computed expression) to a pgEnum column needs an explicit ::enum cast; bare string literals coerce but a CASE result is text.
---

Assigning `sql\`CASE WHEN ... THEN 'failed' ELSE 'pending' END\`` to a `pgEnum`
column fails with Postgres `42804: column "<col>" is of type <enum> but
expression is of type text`. Cast the whole expression: `(CASE ... END)::<enum>`.

**Why:** A bare string literal in `.set({status: 'failed'})` is sent as an
`unknown`-typed literal/parameter, which Postgres implicitly coerces to the enum.
But a CASE expression's result type resolves to `text`, and text→enum is NOT an
implicit *assignment* cast. The same trap applies to any computed assignment
(COALESCE, concat, subquery, `sql` template) targeting an enum column.

**How to apply:** Whenever you assign a `sql\`...\`` expression (not a plain
literal/parameter) to a column backed by `pgEnum` (in this repo: `crawl_status`,
`page_status`, `page_type`, `validation_status`, `log_level`), append `::<enum>`.
A plain `.set({col: 'value'})` does NOT need it. Symptom if missed: the query
throws only when that branch actually executes — e.g. crawler `markFailed`
(`scripts/src/crawler/queue.ts`) crashed the entire crawl the first time any page
exhausted its retries, so short runs looked fine and only the full crawl hit it.
