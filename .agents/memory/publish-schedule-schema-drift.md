---
name: Publish/schedule schema drift (page_status enum + scheduled_for)
description: Why scheduling silently breaks in dev/prod and how to re-sync the enum/column it needs
---

The CMS publish lifecycle needs DB shapes that are easy to lose because this repo
has NO drizzle migrations dir — schema is applied via `drizzle-kit push`, which
**silently fails on Helium** (the Replit-managed Postgres). So a dev DB that was
never successfully pushed, or a checkpoint/rollback, can be missing:

- `page_status` enum values `review` and `scheduled` (dev had only
  draft/published/archived) → scheduling throws `invalid input value for enum
  page_status: "scheduled"` (22P02).
- `pages.scheduled_for` column + `pages_scheduled_for_idx` index → scheduling /
  due-publish throws `column "scheduled_for" of relation "pages" does not exist`
  (42703).

**Why it matters:** the publishing routes' RBAC/invariant tests use a fake DB, so
this drift is invisible until a real write hits the DB — scheduling looks
implemented but is dead in any environment whose DB lacks these shapes. The same
gap very likely exists in **production** (it was never pushed there either);
prod only gets schema via a **re-publish** (publish diffs dev→prod), and the
agent must not run DDL against prod.

**How to re-sync dev (idempotent, autocommit — ADD VALUE can't run in a txn):**
```
ALTER TYPE "page_status" ADD VALUE IF NOT EXISTS 'review' BEFORE 'published';
ALTER TYPE "page_status" ADD VALUE IF NOT EXISTS 'scheduled' BEFORE 'published';
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "scheduled_for" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "pages_scheduled_for_idx" ON "pages" ("scheduled_for");
```
Run via a tsx script inside the `scripts/` pkg (so `@workspace/db` resolves) and
`db.execute(sql\`...\`)`. Verify the live-DB test
`cms-publishing.integration.test.ts` (gated `VERIFY_CMS_WRITE=1`) goes green —
it's the canary for this exact drift.
