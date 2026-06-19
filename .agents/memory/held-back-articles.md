---
name: Held-back broken articles (editor review gate)
description: How failed-validation crawled pages are kept out of the public read API, and why sign-off is not sticky.
---

# Holding back broken articles

A crawled page whose content-fidelity validation `status === "fail"` is persisted
with `pages.status = "draft"` (in `storePage(page, { validationStatus })`,
threaded from `pipeline.processItem`). Everything else becomes `"published"`.

The public read API already filters `status = "published"` (list in
`artifacts/api-server/src/lib/posts.ts`, detail route in `routes/posts.ts`), so a
draft page is automatically absent from `/api/posts` and 404s on
`/api/posts/{slug}` — no API change was needed. An editor queue is emitted as
`reports/held-back-articles.json` (draft `pageType="post"` pages + their latest
`validation_reports` row) plus a `heldBackArticles` count in
`migration-readiness.json`.

**Why reuse `draft` instead of a new `needs-review` enum value:** `pageStatusEnum`
is `["draft","published","archived"]` and schema migrations on the Replit-managed
Postgres are painful (drizzle-kit `push` silently dies; see replit.md gotcha).
Reusing `draft` satisfies the "keep it out of the public API until reviewed"
requirement with zero migration.

**Why sign-off is NOT sticky (intentional):** the upsert overwrites `status` on
every re-crawl, so a previously-failing page that later passes is auto-published,
and a previously-published page that now fails is demoted to draft. The intended
workflow is "fix the extraction/source, re-crawl, and it republishes when
validation passes." If a durable human-approval marker is ever required, it needs
a separate field/table — do not infer approval from `status` alone.

**How to apply:** any new write path that persists a page must keep threading the
validation status so the gate isn't bypassed. The held-back report's "latest
validation per page" relies on `validation_reports` being insert-only and queried
`ORDER BY createdAt DESC` (first row per `pageId` = latest).
