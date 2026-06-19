---
name: Orval path+query param collision
description: TS2308 from orval when an operation mixes path and query params
---

In this repo's orval setup (zod + typescript split outputs both re-exported from `@workspace/api-zod`), an operation that has BOTH a path param and query params (e.g. `GET /categories/{slug}/posts?page=&limit=`) generates a zod **value** `ListCategoryPostsParams` in `api.ts` AND a TS **type** of the same name in `types/`. The barrel `export *` of both then fails with TS2308 ("already exported a member named ...").

**Why:** query-only ops get a `<Op>QueryParams` zod name (no clash with the `<Op>Params` type), but adding a path param makes orval drop the `Query` infix, so the names collide. `export type *` does NOT fix it — TS still treats value vs type as ambiguous.

**How to apply:** avoid path+query mixed operations. Prefer flat endpoints with the slug as a query filter (e.g. `GET /posts?category={slug}`) instead of nesting (`/categories/{slug}/posts`). Path-only (`/posts/{slug}`) and query-only (`/posts?...`) operations are fine.

## Sibling case: component-schema name == operation-derived name

A `components/schemas/X` whose name matches an operation's generated request/response name (orval derives `<PascalOperationId>Body` / `<PascalOperationId>Response` from `operationId`) also produces TS2308 in the `@workspace/api-zod` barrel — the schema-derived value/type and the operation-derived value/type collide. E.g. operationId `finalizeUpload` generates `FinalizeUploadResponse`, so a component schema literally named `FinalizeUploadResponse` clashes.

**Why:** the existing convention already dodges this — `requestUploadUrl` (op) → `RequestUploadUrl{Body,Response}` while its component schemas are named `UploadUrl{Request,Response}` (different stem). Mirroring the operationId stem in a schema name reintroduces the clash.

**How to apply:** name request/response **component schemas** with a different stem than the operationId (e.g. op `finalizeUpload` → schemas `UploadFinalizeRequest`/`UploadFinalizeResult`, NOT `FinalizeUpload*`).
