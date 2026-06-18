---
name: Orval path+query param collision
description: TS2308 from orval when an operation mixes path and query params
---

In this repo's orval setup (zod + typescript split outputs both re-exported from `@workspace/api-zod`), an operation that has BOTH a path param and query params (e.g. `GET /categories/{slug}/posts?page=&limit=`) generates a zod **value** `ListCategoryPostsParams` in `api.ts` AND a TS **type** of the same name in `types/`. The barrel `export *` of both then fails with TS2308 ("already exported a member named ...").

**Why:** query-only ops get a `<Op>QueryParams` zod name (no clash with the `<Op>Params` type), but adding a path param makes orval drop the `Query` infix, so the names collide. `export type *` does NOT fix it — TS still treats value vs type as ambiguous.

**How to apply:** avoid path+query mixed operations. Prefer flat endpoints with the slug as a query filter (e.g. `GET /posts?category={slug}`) instead of nesting (`/categories/{slug}/posts`). Path-only (`/posts/{slug}`) and query-only (`/posts?...`) operations are fine.
