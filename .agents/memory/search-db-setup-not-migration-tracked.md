---
name: Search DB setup is not migration-tracked
description: pg_trgm extension + trigram GIN indexes applied via raw executeSql are not tracked by drizzle migrations and can vanish from dev; prod gets them only via re-publish.
---

The CMS `/cms/search` feature depends on three DB objects: the `pg_trgm` extension, the `saved_views` table, and ~18 trigram GIN indexes (`*_trgm`, declared across the `lib/db/src/schema/*.ts` files + `saved-views.ts`).

**Lesson:** A note saying "applied to DEV via executeSql" is NOT proof they still exist. The `pg_trgm` extension and the GIN trigram indexes are applied as raw DDL (drizzle-kit push is broken on Helium), so they are not part of any migration journal. A dev DB **rollback/checkpoint restore** can wipe them while leaving the rest of the schema intact — observed state was all three objects absent in both dev AND prod despite replit.md claiming they were applied to dev.

**Why:** drizzle does not emit `CREATE EXTENSION`; raw-executeSql index DDL isn't replayed by `db:push`/post-merge, so nothing re-creates them after a restore.

**How to apply:**
- Always re-verify presence with explicit booleans before trusting prior notes:
  `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_trgm')`,
  `SELECT to_regclass('public.saved_views') IS NOT NULL`,
  `SELECT count(*) FROM pg_indexes WHERE indexname LIKE '%\_trgm'` (expect 18).
  Header-only `executeSql` output (e.g. `extname\n` with no row) means ABSENT — don't misread it as present.
- Production schema is publish-managed: the agent must NOT run DDL against prod (`executeSql` prod is read-only). Apply to dev, then have the user **re-publish**.
- Open risk: Replit's publish dev→prod diff may not create the `pg_trgm` extension on prod. If it doesn't, the GIN trigram indexes and the `%` similarity operator fail on prod. Verify the extension exists on prod after a publish.

**Same failure mode applies to the `page_views` analytics table.** It and its 3 indexes (`lib/db/src/schema/analytics.ts`) were applied to dev via raw executeSql, are NOT migration-tracked, and were found absent in dev after a rollback. Self-healing step: `pnpm --filter @workspace/scripts run ensure:analytics` (`scripts/src/ensure-analytics.ts`, idempotent CREATE TABLE/INDEX IF NOT EXISTS, wired into `scripts/post-merge.sh`). Match drizzle's FK name `page_views_page_id_pages_id_fk` in the raw DDL so the publish diff stays clean. Prod still needs a re-publish.
