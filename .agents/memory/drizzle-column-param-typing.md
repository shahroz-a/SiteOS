---
name: Drizzle column helper param typing
description: Why annotating a helper's column param as `typeof someTable.id` is fragile across composite-lib declaration emit, and what to use instead.
---

# Drizzle column-param typing fragility

A leaf package (e.g. `artifacts/api-server`) consumes `@workspace/db` schema via the
lib's emitted `dist/*.d.ts`. When `tsc --build` re-emits those declarations, drizzle
`PgColumn` types for different tables can flip between a widened/portable form and a
precise branded form depending on subtle column flags (`notNull`, `hasDefault`,
`isPrimaryKey`).

A helper typed like `const childScope = (col: typeof pagesTable.id) => inArray(col, ...)`
will then accept `faqTable.pageId` in one build state and REJECT
`internalLinksTable.pageId` / `imagesTable.pageId` in another — even though every call
site is identical `childScope(xTable.pageId)`. The give-away: only SOME of N identical
calls error (TS2345 "page_id is not assignable to id"), and the same code typechecked
clean earlier in the session from a stale incremental cache.

**Rule:** never annotate a "any column" helper param with `typeof specificTable.col`.
Use `AnyPgColumn` (`import type { AnyPgColumn } from "drizzle-orm/pg-core"`).

**Why:** `typeof pagesTable.id` is the precise branded type of ONE column; passing any
other column relies on structural compatibility that declaration-emit does not
guarantee. `AnyPgColumn` is the intended "any column" type and is stable across emit.

**How to apply:** when you see TS2345 column-not-assignable errors clustered in DB
glue (content-io / export / import helpers) right after a `tsc --build` / `typecheck:libs`
/ codegen, suspect this, not your own change. Fix the helper's param type rather than
the call sites. Run `pnpm run typecheck:libs` (or `tsc --build --force`) then the leaf
`pnpm --filter @workspace/<pkg> run typecheck` to confirm.
